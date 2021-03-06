import _ from 'lodash'
import needle from 'needle'
import SteamID from 'steamid'

const filters = ['basic', 'price_overview', 'release_date', 'metacritic', 'developers', 'genres', 'demos'].join(',')
const token = require('./../../../../config.json').steamAPIKey
const endpoints = {
  profile: `https://steamcommunity.com/id/%q%/?xml=1`, // Unused
  profileSummary: `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${token}&steamids=%q%`,
  miniProfile: `https://steamcommunity.com/miniprofile/%q%`, // Unused
  gameSummary: `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${token}&steamid=%q%&include_played_free_games=1`,
  gameRecent: `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${token}&steamid=%q%`,
  appDetailsBasic: `https://store.steampowered.com/api/appdetails?appids=%q%&filters=basic`,
  appDetails: `https://store.steampowered.com/api/appdetails?appids=%q%&filters=${filters}&cc=%cc%`,
  packageDetails: `https://store.steampowered.com/api/packagedetails/?packageids=%q%&cc=us`, // Unused
  searchApps: `https://steamcommunity.com/actions/SearchApps/%q%`,
  numPlayers: `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=%q%`,
  userBans: `https://api.steampowered.com/ISteamUser/GetPlayerBans/v0001/?key=${token}&steamids=%q%`,
  appList: `https://api.steampowered.com/ISteamApps/GetAppList/v0002/`, // Unused
  userLevel: `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${token}&steamid=%q%`,
  resolveVanity: `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${token}&vanityurl=%q%`,
  userWishList: `https://store.steampowered.com/wishlist/profiles/%q%`
}

const getUrl = (type, param, cc) => {
  let out = endpoints[type].replace('%q%', param).replace('%cc%', cc)
  return (cc ? out.replace('%cc%', cc) : out)
}

const getIDFromProfile = id => {
  return new Promise((resolve, reject) => needle.get(getUrl('resolveVanity', id), (err, resp, body) => {
    if (!err && body && body.response) {
      return body.response.success === 1 ? resolve(body.response.steamid) : reject("Invalid Vanity ID")
    }

    return reject('Error retrieving profile ID')
  }))
}

const formatProfileID = id => {
  return new Promise((resolve, reject) => {
    if (id.match(/^[0-9]+$/) || id.match(/^STEAM_([0-5]):([0-1]):([0-9]+)$/) || id.match(/^\[([a-zA-Z]):([0-5]):([0-9]+)(:[0-9]+)?\]$/)) {
      let sID = new SteamID(id)
      if (sID.isValid()) return resolve(sID.getSteamID64())
      else return reject('Invalid ID')
    } else getIDFromProfile(id).then(resolve).catch(reject)
  })
}

const getUserLevel = id => {
  return new Promise(resolve => needle.get(getUrl('userLevel', id), (err, resp, body) => {
    if (!err && body && body.response) return resolve(body.response.player_level)
    else return resolve(0)
  }))
}

const getUserBans = id => {
  return new Promise(resolve => needle.get(getUrl('userBans', id), (err, resp, body) => {
    if (!err && body && body.players[0]) return resolve(body.players[0])
    else return resolve(0)
  }))
}

const getUserGames = id => {
  return new Promise((resolve, reject) => needle.get(getUrl('gameSummary', id), (err, resp, body) => {
    if (!err && body && body.response) return resolve(body.response)
    else return reject('Error retrieving user games')
  }))
}

const getUserRecentlyPlayedGames = id => {
  return new Promise((resolve, reject) => needle.get(getUrl('gameRecent', id), (err, resp, body) => {
    if (!err && body && body.response) return resolve(body.response)
    else return reject('Error retrieving user recently played games')
  }))
}

const getAppDetails = (appid, cc, basic) => {
  return new Promise((resolve, reject) => needle.get(getUrl(basic ? 'appDetailsBasic' : 'appDetails', appid, cc), (err, resp, body) => {
    if (!err && body) {
      if (_.get(body, `[${appid}].success`)) return resolve(body[appid].data)
      else return reject(`Couldn't fetch app details for that AppID, invalid? ${appid}`)
    }

    return reject('Error retrieving game details')
  }))
}

const searchForApp = (query, isAppID) => {
  return new Promise((resolve, reject) => {
    if (isAppID) return resolve(query)
    needle.get(getUrl('searchApps', query), (err, resp, apps) => {
      if (!err && apps.length) return resolve(apps[0].appid)
      else return reject("Couldn't find an app with that name")
    })
  })
}

const getPlayersForApp = (appid, allowUnknown) => {
  return new Promise((resolve, reject) => needle.get(getUrl('numPlayers', appid), (err, resp, body) => {
    if (!err && body && body.response) {
      if (typeof body.response.player_count !== 'undefined') return resolve(body.response)
      else {
        if (allowUnknown) {
          return resolve({})
        }

        return reject('Unable to view player counts for this app')
      }
    }

    return reject('Error retrieving player counts')
  }))
}

export function getUserWishlist(id) {
  return new Promise((resolve, reject) => formatProfileID(id).then(newID => {
    needle.get(getUrl('userWishList', newID), { follow_max: 3 }, (err, resp, body) => {
      if (!err && body) {
        try {
          const wishlistData = JSON.parse(body.match(/var g_rgAppInfo ? = ?({.+});/)[1])
          const sortedData = _.sortBy(_.map(wishlistData, (data, appid) => ({ appid, ...data, priority: data.priority === 0 ? null : data.priority })), 'priority')

          return resolve({ data: sortedData, id: newID })
        } catch (e) {
          if (body.match(/var g_rgWishlistData = \[\];/)) {
            return resolve({ empty: true })
          }

          return reject('Error parsing users wishlist')
        }
      } else return reject('Error retrieving users wishlist')
    })
  }).catch(reject))
}

export function getProfileInfo(id) {
  return new Promise((resolve, reject) => formatProfileID(id).then(newID => needle.get(getUrl('profileSummary', newID), (err, resp, body) => {
    if (!err && body) {
      let profile = body.response.players[0]
      Promise.all([ getUserLevel(newID), getUserBans(newID), getUserGames(newID), getUserRecentlyPlayedGames(newID) ]).then(([ level, bans, games, recentlyPlayed ]) => {
        profile.user_level = level
        profile.bans = bans
        profile.totalgames = games.game_count || undefined
        profile.recentlyPlayed = recentlyPlayed.games && recentlyPlayed.games.length ? recentlyPlayed.games : undefined
        if (!games || !games.games) {
          profile.mostplayed = {}
          return resolve(profile)
        }
        let sortedGames = games.games.sort((a, b) => b.playtime_forever - a.playtime_forever)
        profile.mostplayed = sortedGames[0]
        getAppDetails(sortedGames[0].appid, false, true).then(game => {
          if (game) {
            profile.mostplayed.name = game.name
            return resolve(profile)
          }
        }).catch(reject)
      }).catch(reject)
    } else return reject('Error retrieving profile info')
  })).catch(reject))
}

export function getGamesForUser(id) {
  return new Promise((resolve, reject) => {
    formatProfileID(id)
      .then(getUserGames)
      .then(resolve)
      .catch(reject)
  })
}

export function getAppInfo(appid, cc = 'US', playersOnly) {
  return new Promise((resolve, reject) => {
    const isAppID = appid.match(/^\d+$/)
    searchForApp(appid, isAppID).then(id => {
      Promise.all([getAppDetails(id, cc), getPlayersForApp(id, !playersOnly)]).then(([app, players]) => {
        if (playersOnly) {
          players.name = app.name
          return resolve(players)
        }
        app.player_count = players.player_count
        return resolve(app)
      }).catch(reject)
    }).catch(reject)
  })
}

// Credit to DoctorMcKays original code this is based off
// https://github.com/DoctorMcKay/steam-irc-bot/blob/master/irc-commands/steamid.js
export function getSteamIDInfo(id) {
  return new Promise((resolve, reject) => formatProfileID(id).then(newID => {
    let sid = new SteamID(newID)
    let i
    let details = []
    for (i in SteamID.Universe) {
      if (sid.universe === SteamID.Universe[i]) {
        details.push(`*Universe:* ${_.capitalize(i.toLowerCase())} (${sid.universe})`)
        break
      }
    }
    for (i in SteamID.Type) {
      if (sid.type === SteamID.Type[i]) {
        details.push(`*Type:* ${i.split('_').map(j => _.capitalize(j.toLowerCase())).join(' ')} (${sid.type})`)
        break
      }
    }
    for (i in SteamID.Instance) {
      if (sid.instance === SteamID.Instance[i]) {
        details.push(`*Instance:* ${_.capitalize(i.toLowerCase())} (${sid.instance})`)
        break
      }
    }
    let msg = `${sid.getSteam3RenderedID()} ${sid.type === SteamID.Type.INDIVIDUAL ? '/ ' + sid.getSteam2RenderedID() : ''} / ${sid.getSteamID64()} \n *Valid:* ${sid.isValid() ? 'True' : 'False'}, ${details.join(', ')}, *AccountID:* ${sid.accountid}`
    return resolve(msg)
  }).catch(reject))
}
