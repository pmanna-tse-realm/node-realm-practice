const Realm = require("realm");
const fs = require("fs");

const appConfig = {
  id: "testbed-eobcc",
  timeout: 15000,
};
const partitionValue = "PUBLIC"
const app = new Realm.App(appConfig);

let realm;

const TestDataSchema = {
  name: 'TestData',
  properties: {
    _id: 'objectId',
    _partition: 'string',
    doubleValue: 'double?',
    longInt: 'int?',
    mediumInt: 'int?'
  },
  primaryKey: '_id'
};

function fileExistsSync(file) {
	try {
		fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK);
		return true;
	} catch (err) {
		return false;
	}
}

function logWithDate(message) {
	let date = new Date();

	console.log(`[${date.toISOString()}] - ${message}`)
}

function errorSync(session, error) {
  if ((error.name === 'ClientReset') && (realm != undefined)) {
		const realmPath = realm.path;
		
		realm.close();
		
		logWithDate(`Needs to reset ${realmPath}…`);
    Realm.App.Sync.initiateClientReset(app, realmPath);
		logWithDate(`Backup from ${error.config.path}…`);

		// Move backup file to a known location for a restore
		fs.renameSync(error.config.path, realmPath + '~');

		// Realm isn't valid anymore, notify user to exit
		realm = null;
  }
}

function transferProgress(transferred, transferables) {
	if (transferred < transferables) {
		logWithDate(`Transferred ${transferred} of ${transferables}`);
	} else {
		logWithDate(`Transfer finished`);
	}
}

async function openRealm(user) {
  try {
    const config = {
      schema: [TestDataSchema],
      sync: {
        user: user,
				partitionValue: partitionValue,
				newRealmFileBehavior: {type: 'downloadBeforeOpen', timeOutBehavior: 'throwException'},
				existingRealmFileBehavior: {type: 'openImmediately', timeOutBehavior: 'openLocalRealm'},
				error: errorSync
      }
    };

		if (process.env.CLEAN_REALM) {
			Realm.deleteFile(config);
			logWithDate(`Cleaned realm ${partitionValue}`);
		}

		realm = await Realm.open(config);

		logWithDate(`Opened realm ${partitionValue}`);
		
		// Add a progress function
		realm.syncSession.addProgressNotification('download', 'reportIndefinitely', transferProgress);

		// If a backup file exists, restore to the current realm, and delete file afterwards
		let backupPath	= realm.path + '~';

		if (fileExistsSync(backupPath)) {
			let backupRealm = await Realm.open({path: backupPath, readOnly: true});
			let backupObjects = backupRealm.objects("TestData");

			logWithDate(`Found ${backupObjects.length} objects in ${backupPath}, proceeding to merge…`);

			realm.beginTransaction();
			backupObjects.forEach(element => {
				realm.create("TestData", element, 'modified');
			});
			realm.commitTransaction();

			logWithDate(`Merge completed, deleting ${backupPath}…`);
			fs.unlinkSync(backupPath);
		}
  } catch (e) {
    console.error(e);
  }
}

async function run() {
	let user  = app.currentUser;

	try {
		if (!user) {
			user = await app.logIn(Realm.Credentials.anonymous());
		}

		logWithDate(`Logged in with the user: ${user.id}`);
		
		Realm.App.Sync.setLogLevel(app, "detail");
		
		await openRealm(user);
		
		if (realm) {
			let objects = realm.objects("TestData");
			
			logWithDate(`Got ${objects.length} objects`)

			function listener(objects, changes) {
				logWithDate(`Received ${changes.deletions.length} deleted, ${changes.insertions.length} inserted, ${changes.newModifications.length} updates`);
			}

			objects.addListener(listener);
		}
	} catch (error) {
		console.error(error);
	} finally {
		setTimeout(() => {
			if (realm) {
				realm.syncSession.removeProgressNotification(transferProgress);
				realm.close();
			}

			logWithDate("Done");

			process.exit(0);
		}, 5000);
	}
}

run().catch(console.dir);
