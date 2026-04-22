import './src/shared';

import auth = require('./src/auth');
import jobs = require('./src/jobs');
import clients = require('./src/clients');
import documents = require('./src/documents');
import tax = require('./src/tax');
import invites = require('./src/invites');
import inventory = require('./src/inventory');
import profile = require('./src/profile');
import misc = require('./src/misc');
import support = require('./src/support');
import readModel = require('./src/read-model');

const exported = Object.assign(
	{},
	auth,
	jobs,
	clients,
	documents,
	tax,
	invites,
	inventory,
	profile,
	misc,
	support,
	readModel,
);

export = exported;