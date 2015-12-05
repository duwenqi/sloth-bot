import Promise from 'bluebird';
import needle from 'needle';

const token = require('./../../../../config.json').steamAPIToken;
const endpoints = {
	profile: 'http://steamcommunity.com/id/%id%/?xml=1',
	profileSummary: 'http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=' + token + '&steamids=%id%',
	gameSummary: 'http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=' + token + '&steamid=%id%&include_played_free_games=1',
	appDetails: 'http://store.steampowered.com/api/appdetails?appids=%id%&filters=basic,price_overview',
	numPlayers: 'http://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=%id%'
};

var Steam, appList;

var getUrl = function(type, id) {
    return endpoints[type].replace('%id%', id);
};

module.exports = Steam = (() => {
	let SteamID = null;
	function Steam(id) {
		if (id)
			SteamID = id;
	}

	Steam.prototype.getIDFromProfile = function() {
		return new Promise((resolve, reject) => {
			try {
				needle.get(getUrl('profile', SteamID), (err, resp, body) => {
					if (!err) {
						if (body.profile) {//body.profile will be returned if valid profile
							SteamID = body.profile.steamID64;
							resolve(body.profile.steamID64);
						} else { //if invalid pofile body.response will contain a .error
							resolve(body.response);
						}
					} else {
						resolve(0);
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	};

	Steam.prototype.getProfileInfo = function() {
		return new Promise((resolve, reject) => {
			try {
				needle.get(getUrl('profileSummary', SteamID), (err, resp, body) => {
					if (!err) {
						let profile = body.response.players[0];
						return this.getProfileGameInfo().then(games => {
							let sortedGames = games.games.sort((a, b) => {
								return b.playtime_forever - a.playtime_forever;
							});
							profile.totalgames = games.game_count;
							profile.mostplayed = sortedGames[0];
							return this.getAppDetails(sortedGames[0].appid).then(game => {
								if (game) {
									profile.mostplayed.name = game.name;
									return resolve(profile);
								}
							});
						});
					} else {
						return resolve(0);
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	};

	Steam.prototype.getProfileGameInfo = function() {
		return new Promise((resolve, reject) => {
			try {
				needle.get(getUrl('gameSummary', SteamID), (err, resp, body) => {
					if (!err)
						return resolve(body.response);
					else
						return resolve(0);
				});
			} catch (e) {
				reject(e);
			}
		});
	};

	Steam.prototype.getAppDetails = function(id) {
		return new Promise((resolve, reject) => {
			try {
				needle.get(getUrl('appDetails', id ? id : SteamID), (err, resp, body) => {
					if (!err && body) {
						id = id ? id : SteamID;
						if (body[id].success)
							return resolve(body[id].data);
						else
							return reject('Couldn\'t fetch app details for that AppID, invalid? ' + id);
					} else
						return reject('Error retrieving game details');
				});
			} catch (e) {
				reject(e);
			}
		});
	};

	Steam.prototype.getNumberOfCurrentPlayers = function(id) {
		return new Promise((resolve, reject) => {
			try {
				needle.get(getUrl('numPlayers', id ? id : SteamID), (err, resp, body) => {
					if (!err)
						if (typeof body.response.player_count != 'undefined')
							return resolve(body.response);
						else
							return resolve(0);
					else
						return resolve(0);
				});
			} catch (e) {
				reject(e);
			}
		});
	};

	Steam.prototype.getAppIDByGameName = function() {
		return new Promise((resolve, reject) => {
			appList = require('./../../../../steamGames.json').applist.apps;
			var apps = appList.filter(function(game) {
				if (game.name.toUpperCase().replace('-',' ').indexOf(SteamID.toUpperCase().replace('-',' ')) >= 0)
					return game;
			});
			if (apps[0] && apps.length > 0) {
				SteamID = apps[0].appid;
				resolve(apps);
			} else {
				reject("Couldn't find a game with that name");
			}
		});
	};

	Steam.prototype.getAppInfo = function(id) {
		return new Promise((resolve, reject) => {
			Promise.join(this.getAppDetails(id ? id : SteamID), this.getNumberOfCurrentPlayers(id ? id : SteamID), (info, players) => {
				if (info && players) {
					info.player_count = players.player_count;
					resolve(info);
				}
			}).catch(reject);
		});
	};

	return Steam;
})();