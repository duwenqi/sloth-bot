import _ from 'lodash';
import path from 'path';
import Promise from 'bluebird';
import database from './database';
import permissions from './permissions';
import {
    find as findPlugins
}
from './utils/plugins';



var plugins = [];

findPlugins().forEach(plugin => {
    plugins.push(require('./plugins/' + plugin))
});

const getUserlevel = user => {
    if ((permissions.superadmins.indexOf(user) > -1))
        return 'superadmin';
    else if ((permissions.admins.indexOf(user) > -1))
        return 'admin';
    else
        return 'user';
}



module.exports = {
    parse(user, channel, text) {
        return new Promise((resolve, reject) => {

            let username = user.name.toString().toLowerCase();

            if ((permissions.ignored.indexOf(username) > -1))
                return resolve(false);

            let userLevel = getUserlevel(username);

            let command = text.substr(1).split(' ')[0];
            let context = (text.indexOf(' ') >= 0) ? text.substr(1).split(' ').splice(1).join(' ') : undefined;

            let cmdLevel = false;
            let call = false;
            let plugin = _.find(plugins, plugin => {
                return _.find(plugin.commands, cmd => {
                    if (cmd.alias.indexOf(command) > -1) {
                        if (cmd.userLevel)
                            cmdLevel = cmd.userLevel;

                        call = cmd.command;
                        return true;
                    } else
                        return false;
                });
            });

            if (!plugin)
                return reject('Command not found')

            if (cmdLevel && !(cmdLevel.indexOf(userLevel) > -1))
                return resolve({
                    type: 'channel',
                    message: 'Insufficient Permissions'
                });

            plugin[call](user, channel, context, plugins, userLevel)
                .then(resolve)
                .catch(reject);
        });
    }
};