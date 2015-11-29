import _ from 'lodash';
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
	console.log(endpoints[type].replace('%id%', id));
    return endpoints[type].replace('%id%', id);
};

module.exports = Steam = (() => {
	function Steam(id) {
		this.steamid = id;
	}

	Steam.prototype.getIDFromProfile = function() {
		return new Promise((resolve, reject) => {
			try {
				needle.get(getUrl('profile', this.steamid), (err, resp, body) => {
					if (!err) {
						if (body.profile) {//body.profile will be returned if valid profile
							resolve(body.profile.steamID64);
						} else { //if invalid pofile body.response will contain a .error
							resolve(body.response);
						}
					} else {
						reject(err);
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
				needle.get(getUrl('profileSummary', this.steamid), (err, resp, body) => {
					if (!err) {
						let profile = body.response.players[0];
						return this.getProfileGameInfo(this.steamid).then(games => {
							let sortedGames = games.games.sort((a, b) => {
								return b.playtime_forever - a.playtime_forever;
							});
							profile.totalgames = games.game_count;
							profile.mostplayed = sortedGames[0];
							return this.getGameDetails(sortedGames[0].appid).then(game => {
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

	Steam.prototype.getProfileGameInfo = function(id) {
		return new Promise((resolve, reject) => {
			try {
				needle.get(getUrl('gameSummary', id), (err, resp, body) => {
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

	Steam.prototype.getGameDetails = function(id) {
		return new Promise((resolve, reject) => {
			try {
				needle.get(getUrl('appDetails', id), (err, resp, body) => {
					if (!err) {
						if (body[id].success)
							return resolve(body[id].data);
						else
							return resolve(undefined);
					} else {
						return resolve(0);
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	};

	return Steam;
})();