const _ = require('lodash')
const moment = require('moment')
const puppeteer = require('puppeteer')
import { _getStandings, makePuppeteerUndetectable, uploadImageToSlack, cacheTs } from './helpers'
require('./definitions')

/**
 * Generates list of weeks in each stage
 * @param {Stage} stage
 */
const generateWeeksForStage = stage => {
  let week = 0
  return stage.matches
    .sort((a, b) => {
      return a.startDateTS - b.startDateTS
    })
    .reduce((res, match) => {
      if (match.startDate) {
        var startDate = moment(match.startDate).startOf("isoWeek").valueOf()
        if (!res.find(e => e.startDate === startDate)) {
          var endDate = moment(startDate).add(1, "week").valueOf()
          res.push({
            id: week,
            startDate,
            endDate,
            name: `Week ${week + 1}`
          })
          week++
        }
      }
      return res
    }, [])
}

/**
 * Returns current stage
 * @param {[Stage]} stages
 * @returns {Stage}
 */
const getCurrentStage = stages => {
  for (var time = Date.now(), stage = stages[0], i = 0; i < stages.length; i++) {
    if (stages[i].enabled) {
      const firstMatch = stages[i].matches.find(s => s.startDate)
      const lastMatch = _.cloneDeep(stages[i].matches).reverse().find(s => s.startDate)

      if (!firstMatch || !lastMatch) break

      stage = stages[i]

      const startDate = +moment(firstMatch.startDate)
      const endDate = +moment(lastMatch.startDate).endOf('day')
      if (startDate > time || startDate < time && endDate > time) break
    }
  }

  return stage
}

/**
 * Returns current week for a stage
 * @param {[StageWeek]} weeks
 * @returns {StageWeek}
 */
const getCurrentWeek = weeks => {
  for (var time = Date.now(), week = weeks[0], i = 0; i < weeks.length; i++) {
    week = weeks[i]
    const startDate = +moment(week.startDate)
    const endDate = +moment(week.endDate)

    if (startDate > time || startDate < time && endDate > time) {
      break
    }
  }

  return week
}

/**
 * Returns matches for a stage in a week
 * @param {[Match]} matches
 * @param {StageWeek} week
 * @returns {[Match]}
 */
const getMatchesForStageWeek = (matches, week) => {
  return matches.filter(match => (
    moment(match.startDate).valueOf() >= week.startDate &&
    moment(match.startDate).valueOf() < week.endDate
  ))
}

/**
 * Returns matches for each day in a week
 * @param {[Match]} weekMatches
 * @returns {[WeekDays]}
 */
const getDaysForWeek = weekMatches => {
  return weekMatches.reduce((res, match) => {
    const matchStartDate = moment(match.startDate)
    const existingDay = res.find(day => {
      return day.date === matchStartDate.format("MM/DD/YYYY")
    })

    if (existingDay) {
      existingDay.matches.push(match)
    } else {
      res.push({
        date: matchStartDate.format("MM/DD/YYYY"),
        timestamp: matchStartDate.startOf('day').valueOf(),
        displayDate: {
          dayOfWeek: moment(matchStartDate).format('dddd'),
          monthAndDay: moment(matchStartDate).format('MMMM Do')
        },
        matches: [match]
      })
    }

    return res
  }, [])
}

/* eslint-disable */
/**
 * @param {[Stage]} stages 
 */
const mapData = stages => {
  const mappedStages = stages.map(stage => Object.assign({}, stage, { weeks: generateWeeksForStage(stage) }))
  const currentStage = getCurrentStage(mappedStages)
  const currentWeek = getCurrentWeek(currentStage.weeks)
  const weekMatches = getMatchesForStageWeek(currentStage.matches, currentWeek)
  const weekDays = getDaysForWeek(weekMatches)
}

// mapData(data.data.stages)
/* eslint-enable */

export async function getLiveMatch(channelId) {
  let browser
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox'],
      headless: true
    })
    const page = await browser.newPage()
    await makePuppeteerUndetectable(page)
    page.setViewport({ width: 400, height: 700 })
    await page.goto('https://overwatchleague.com/en-us/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.LiveStream-info', { timeout: 3000 })
    await page.waitForFunction(`document.querySelector('.LiveStream-info').offsetHeight > 200`, { timeout: 1500 })

    const liveInfoElm = await page.evaluate(selector => {
      const element = document.querySelector(selector) // eslint-disable-line no-undef
      const { x, y, width, height } = element.getBoundingClientRect()
      return { left: x, top: y, width, height }
    }, '.LiveStream-info')

    const screenshot = await page.screenshot({
      clip: {
        x: liveInfoElm.left,
        y: liveInfoElm.top,
        width: liveInfoElm.width,
        height: liveInfoElm.height
      }
    })

    await browser.close()
    await uploadImageToSlack(screenshot, 'live-stats', channelId)
  } catch (e) {
    await browser.close()
    throw e
  }
}

/**
 * @returns {MappedStandings}
 */
export async function getOverallStandaings() {
  return _getStandings().then(data => {
    const rankData = data.ranks.map(rank => {
      const team = rank.competitor
      const record = rank.records[0]

      return {
        name: team.abbreviatedName,
        match_wins: record.matchWin,
        match_losses: record.matchLoss,
        match_win_percent: record.matchWin / (record.matchLoss + record.matchWin),
        map_wins: record.gameWin,
        map_losses: record.gameLoss,
        map_ties: record.gameTie,
        map_win_percent: record.gameWin / (record.gameLoss + record.gameWin + record.gameTie),
        map_differential: record.gameWin - record.gameLoss
      }
    })

    return {
      data: rankData,
      updated: cacheTs['standings']
    }
  }, Promise.reject)
}

const stageMapping = {
  'preseason': 0,
  'playoffs': 5,
  'grandfinal': 6,
  'grandfinals': 6,
  'allstar': 7
}

const stageNameMapping = {
  0: 'The Preseason',
  1: 'Stage 1',
  2: 'Stage 2',
  3: 'Stage 3',
  4: 'Stage 4',
  5: 'The Playoffs',
  6: 'The Grand Finals',
  7: 'All-Star Weekend'
}

export async function getStandingsForStage(stage) {
  return _getStandings().then(data => {
    const stageNum = stageMapping[stage.toString().replace(/[- ]g/, '')] || stage
    const stageData = data.stages[stageNum]

    if (!stageData) {
      throw 'Invalid stage specified! Valid values are 0-7, preseason, playoffs, grandfinal, allstar'
    }

    const outStageData = stageData.teams.map(team => {
      const standings = team.standings
      const winPercent = standings.wins / (standings.losses + standings.wins)

      return {
        name: team.abbreviatedName,
        match_wins: standings.wins,
        match_losses: standings.losses,
        match_win_percent: _.isNaN(winPercent) ? 0 : winPercent,
        map_wins: standings.points
      }
    })

    return {
      data: outStageData,
      stage_name: stageNameMapping[stageNum],
      updated: cacheTs['standings']
    }
  }, Promise.reject)
}
