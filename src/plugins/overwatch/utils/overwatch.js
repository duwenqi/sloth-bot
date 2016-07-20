import Promise from 'bluebird'
import needle from 'needle'

const apiUrl = 'https://owapi-1368.appspot.com/api/u'

const endpoints = {
  stats: `${apiUrl}/%u/stats/quickplay`, // returns basic stats for user
  heroes: `${apiUrl}/%u/heroes/quickplay`, // returns top 5 played heroes
  hero: `${apiUrl}/%u/hero/%h/quickplay`
}

const getURL = (type, user, hero) => {
  let out = endpoints[type].replace('%u', user)
  return (hero ? out.replace('%h', hero) : out)
}

export function getUserStats(user, getHeroes) {
  return new Promise((resolve, reject) => needle.get(getURL('stats', user), (err, resp, body) => {
    if (!err && body) {
      if (!body.ok) return reject(`Error: ${resp.statusCode} - ${body.error || ''}`)
      if (getHeroes) {
        getTopHeroes(user).then(heroes => {
          body.data.heroes = heroes
          return resolve(body.data)
        }).catch(reject)
      } else return resolve(body.data)
    } else {
      return reject(`getUserStatsErr: ${err}`)
    }
  }))
}

export function getTopHeroes(user) {
  return new Promise((resolve, reject) => needle.get(getURL('heroes', user), (err, resp, body) => {
    if (!err && body) {
      if (!body.ok) return reject(`Error: ${resp.statusCode} - ${body.error || ''}`)
      return resolve(body.data)
    } else {
      return reject(`getTopHeroesErr: ${err}`)
    }
  }))
}

export function getHero(user, hero, getProfile) {
  return new Promise((resolve, reject) => needle.get(getURL('hero', user, hero), (err, resp, body) => {
    if (!err && body) {
      if (!body.ok) return reject(`Error: ${resp.statusCode} - ${body.error || ''}`)
      if (getProfile) {
        getUserStats(user).then(stats => {
          body.data.player = stats.player
          return resolve(body.data)
        }).catch(reject)
      } else return resolve(body.data)
    } else {
      return reject(`getHeroErr: ${err}`)
    }
  }))
}
