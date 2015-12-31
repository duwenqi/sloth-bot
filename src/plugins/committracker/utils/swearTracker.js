import Promise from 'bluebird';
import _ from 'lodash';
import needle from 'needle';
import async from 'async';
import database from '../../../database';
import slack from '../../../slack';

const config = require('../../../../config.json');
const word_list = ["fuck", "bitch", "shit", "tits", "asshole", "arsehole", "cocksucker", "cunt", "hell", "douche", "testicle", "twat", "bastard", "sperm", "shit", "dildo", "wanker", "prick", "penis", "vagina", "whore", "boner"];

var username, updating;

// Attempt to use a Github Authorization token
var githubAuthentication = {headers: {}};
if (config.githubToken && config.githubToken.length > 10) {
    let buffer = new Buffer(config.githubToken);
    githubAuthentication.headers = {
        'Authorization': 'Basic ' + buffer.toString('base64')
    };
}

// Github API Endpoints
const endpoints = {
    repositories: 'https://api.github.com/users/%u/repos',
    commits: 'https://api.github.com/repos/%u/%r%/commits?author=%u'
};

// Formats Endpoint URLs
const getUrl = ((type, repo) => {
    let out = endpoints[type].replace(/%u/g, username);
    console.log(out.replace('%r%', repo));
    return out.replace('%r%', repo);
});

// Retrieves all users repositories
const getRepos = (() => {
    return new Promise((resolve, reject) => {
        needle.get(getUrl('repositories'), githubAuthentication, (err, resp, body) => {
            if (!err && body) {
                if (!body[0] && !body.message) 
                    reject('User has no repos');
                else if (body.message === 'Not Found')
                    reject('Cannot find a user by that name');
                else if (body[0].id)
                    resolve(body);
            } else {
                reject("Error fetching repos", err);
            }
        });
    });
});

// Retrieves most recent commits for a repo
const getCommitsForRepos = (repos => {
    return new Promise((resolve, reject) => {
        let out = [];
        async.each(repos, (repo, cb) => {
            needle.get(getUrl('commits', repo), githubAuthentication, (err, resp, body) => {
                if (!err && body && body[0].commit) {
                    out.push(body);
                    cb(); 
                } else {
                    cb(err);
                }
            });
        }, err => {
            if (err) {
                return reject(err);
            } else {
                resolve(out);
            }
        });
    });
});

// Goes through all commits and searches for swears
const findSwearsInCommits = (commits => {
    return new Promise((resolve, reject) => {
        let commitsWithSwears = [];

        async.each(commits, (commit, cb) => {
            _.some(word_list, word => {
                if (commit.commit.message.indexOf(word) >= 0) {
                    let out = {
                        message: commit.commit.message,
                        url: commit.html_url,
                        sha: commit.sha,
                        user: username,
                        repo: commit.html_url.split('/')[4]
                    };
                    commitsWithSwears.push(out);
                    return true;
                }
            });
            cb();
        }, err => {
            if (err) {
                return reject(err);
            } else {
                if (commitsWithSwears[0]) {
                    resolve(commitsWithSwears);
                } else {
                    saveToDB(null);
                    reject('Found no swears in recent commits :/');
                }
            }
        });
    });
});

// Formats all the repos and just returns the names
const formatRepos = (repos => {
    return new Promise(resolve => {
        let out = [];
        async.each(repos, (repo, cb) => {
            if (repo.fork && !config.includeForks)
                return cb();

            out.push(repo.name);
            cb();
        }, err => {
            if (err)
                return reject(err);
            else {
                resolve(out);
            }
        });
    });
});

// Saves all commits with swears to the DB, dupe commits won't get added to the DB
const saveToDB = (swears => {
    console.log("Save to DB");
    if (swears)
        database.save('swearcommits', swears, {index: 'sha', ensureUnique: true}).catch(err => console.log("Commit already saved", err));
    database.save('swearusers', {
        user: username,
        lastUpdated: Math.round(new Date().getTime() / 1000)
    });
    updating = false;
});

// Start da lulz
const updateSwears = (() => {
    return new Promise((resolve, reject) => {
        updating = true;
        return getRepos()
            .then(formatRepos)
            .then(getCommitsForRepos)
            .then(commits => findSwearsInCommits(_.flatten(commits)))
            .then(saveToDB)
            .catch(err => {
                console.log(err);
                updating = false;
                reject(err);
            });
    });
});

const fetchSwears = (() => {
    return new Promise((resolve, reject) => {
        database.get('swearcommits', {
            key: 'user',
            value: username
        }).then(commits => {
            if (commits[0]) {
                resolve(commits);
            } else {
                reject("I don't have commits for this user, you can fetch some with " + config.prefix + "fetchcommits <user>");
            }
        }).catch(err => {
            reject("I don't have commits for this user, you can fetch some with " + config.prefix + "fetchcommits <user>");
        });
    });
});

const checkIfWeCanUpdate = (() => {
    return new Promise(resolve => {
        console.log(username);
        database.get('swearusers', {
            key: 'user',
            value: username
        }).then(user => {
            console.log(user);
            if (user[0]) {
                if (user[0].lastUpdated + (24 * 3600) < Math.round(new Date().getTime() / 1000)) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            } else {
                resolve(true);
            }
        }).catch(err => {
            if (err === 'NOCOLLECTION') {
                resolve(true);
            }
        });
    });
});

module.exports = {
    retrieveSwearCommits(input) {
        return new Promise((resolve, reject) => {
            username = input;
            fetchSwears().then(resp => {
                return resolve(resp[Math.floor(Math.random() * resp.length)]);
            }).catch(reject);
        });
    },
    updateSwearCommits(user, channel, input) {
        return new Promise((resolve, reject) => {
            console.log(input);
            username = input;
            checkIfWeCanUpdate().then(resp => {
                if (resp) {
                    if (!updating) {
                        slack.sendMessage(channel.id, "User not in DB, attempting to fetch commits now, try again later, this may take some time :)");
                        updateSwears().catch(reject);
                    } else
                        reject('DB update already in progress, try again laterz');
                } else {
                    reject(username + "'s commits have already been updated in the last 24 hours, try again later :)");
                }
            });
        });
    }
};