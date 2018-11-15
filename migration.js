'use strict'

const shell = require('shelljs')
const mkdirp = require('mkdirp')
const exists = require('fs-exists-sync')
const jsonFile = require('jsonfile')
const isWindows = require('is-windows')
const validUrl = require('valid-url')

const PimcoreApiClient = require('./src/lib/pimcore-api')

const TARGET_CONFIG_FILE = 'config.json'
const SOURCE_CONFIG_FILE = 'config.example.json'

const SELF_DIRECTORY = shell.pwd()

const LOG_DIR = `${SELF_DIRECTORY}/var/log`
const INSTALL_LOG_FILE = `${SELF_DIRECTORY}/var/log/install.log`
const GENERAL_LOG_FILE = `${SELF_DIRECTORY}/var/log/general.log`

const Message = require('./src/lib/message.js')

let api

/**
 * Abstract class for field initialization
 */
class Abstract {
  /**
   * Constructor
   *
   * Initialize fields
   */
  constructor (answers) {
    this.answers = answers
  }
}


/**
 * Scripts for initialization of Pimcore instance
 */
class Pimcore extends Abstract {
  /**
   * Creating storefront config.json
   *
   * @returns {Promise}
   */
  createConfig () {
    return new Promise((resolve, reject) => {
      let config

      Message.info(`Creating pimcore config '${TARGET_CONFIG_FILE}'...`)

      try {
        config = jsonFile.readFileSync(SOURCE_CONFIG_FILE)

        let backendPath

        const pimcoreClassFinder = function (className) {
          return availablePimcoreClassess.find((itm) => { return itm.name === className })
        }

        config.elasticsearch.host = this.answers.elasticsearchUrl
        config.elasticsearch.indexName = this.answers.elasticsearchIndexName
        config.pimcore.url = this.answers.pimcoreUrl
        config.pimcore.assetsPath = this.answers.assetsPath
        config.pimcore.apiKey = this.answers.apiKey
        config.pimcore.rootCategoryId = parseInt(this.answers.rootCategoryId)
        config.pimcore.locale = this.answers.locale
        config.pimcore.productClass = Object.assign(config.pimcore.productClass, pimcoreClassFinder(this.answers.productClass))
        config.pimcore.categoryClass = Object.assign(config.pimcore.categoryClass, pimcoreClassFinder(this.answers.categoryClass))
       
        jsonFile.writeFileSync(TARGET_CONFIG_FILE, config, {spaces: 2})
      } catch (e) {
        console.log(e)
        reject('Can\'t create storefront config.')
      }

      resolve()
    })
  }


  /**
   * Start 'npm run import' in background
   *
   * @returns {Promise}
   */
  runImporter (answers) {
    return new Promise((resolve, reject) => {
      Message.info('Starting Pimcore inporter ...')

      let lastExecResult = null
      shell.cd('src')
      if (shell.exec(`node index.js new`).code !== 0) {
        reject('Can\'t create elasticsearch index.')
        resolve(answers)
      }
      if ((lastExecResult = shell.exec(`node index.js taxrules`)) && lastExecResult.code !== 0) {
        reject('Can\'t import the taxrules')
        resolve(answers)
      }      
      if ((lastExecResult = shell.exec(`node index.js categories`)) && lastExecResult.code !== 0) {
        reject('Can\'t import the categories')
        resolve(answers)
      }
      if ((lastExecResult = shell.exec(`node index.js products`)) && lastExecResult.code !== 0) {
        reject('Can\'t import the products')
        resolve(answers)
      }

      if ((lastExecResult = shell.exec(`node index.js publish`)) && lastExecResult.code !== 0) {
        reject('Can\'t publish the index')
        resolve(answers)
      }

      resolve(answers)
    })
  }
}

class Manager extends Abstract {
  /**
   * {@inheritDoc}
   *
   * Assign backend and storefront entities
   */
  constructor (answers) {
    super(answers)

    this.pimcore = new Pimcore(answers)
  }

  /**
   * Trying to create log files
   * If is impossible - warning shows
   *
   * @returns {Promise}
   */
  tryToCreateLogFiles () {
    return new Promise((resolve, reject) => {
      Message.info('Trying to create log files...')

      try {
        mkdirp.sync(LOG_DIR, {mode: parseInt('0755', 8)})

        let logFiles = [
          INSTALL_LOG_FILE,
          GENERAL_LOG_FILE
        ]

        for (let logFile of logFiles) {
          if (shell.touch(logFile).code !== 0 || !exists(logFile)) {
            throw new Error()
          }
        }

        Abstract.logsWereCreated = true
        Abstract.infoLogStream = INSTALL_LOG_FILE
        Abstract.logStream = GENERAL_LOG_FILE
      } catch (e) {
        console.log(e)
        Message.warning('Can\'t create log files.')
      }

      resolve()
    })
  }

  
  /**
   * Initialize all processes for storefront
   *
   * @returns {Promise}
   */
  initPimcore () {
    return this.pimcore.createConfig.bind(this.pimcore)()
      .then(this.pimcore.runImporter.bind(this.pimcore))
  }

  /**
   * Check user OS and shows error if not supported
   */
  static checkUserOS () {
    if (isWindows()) {
      Message.error([
        'Unfortunately currently only Linux and OSX are supported.',
        'To install vue-storefront on your mac please go threw manual installation process provided in documentation:',
        `${STOREFRONT_GIT_URL}/blob/master/doc/Installing%20on%20Windows.md`
      ])
    }
  }

  /**
   * Shows message rendered on the very beginning
   */
  static showWelcomeMessage () {
    Message.greeting([
      'Hi, welcome to the pimcore2vuestorefront setup.',
      'Let\'s configure it together :)'
    ])
  }

  /**
   * Shows details about successful installation finish
   *
   * @returns {Promise}
   */
  showGoodbyeMessage () {
    return new Promise((resolve, reject) => {
      Message.greeting([
        'Congratulations!',
        '',
        'You\'ve just configured Pimcore -> VueStorefront integrator.',
        '',
        'Good Luck!'
      ], true)

      resolve()
    })
  }
}

const urlFilter = function (url) {
    let prefix = 'http://'
    let prefixSsl = 'https://'

    url = url.trim()

    // add http:// if no protocol set
    if (url.substr(0, prefix.length) !== prefix && url.substr(0, prefixSsl.length) !== prefixSsl) {
      url = prefix + url
    }

    // add extra slash as suffix if was not set
    return url.slice(-1) === '/' ? url : `${url}/`
  }

let pimcoreUrl
let availablePimcoreClassess

/**
 * Here we configure questions
 *
 * @type {[Object,Object,Object,Object]}
 */

 function retrieveData(indexES = 'vue_storefront_pimcore') {
   return new Promise((resolve) => {
    const configuration = {
      pimcoreUrl: urlFilter(process.env.PIMCORE_URL),
      apiKey: process.env.PIMCORE_API_KEY,
      elasticsearchUrl: process.env.ELASTICSEARCH_PORT
        ? `${process.env.ELASTICSEARCH_HOST}:${process.env.ELASTICSEARCH_PORT}/` : process.env.ELASTICSEARCH_HOST,
      elasticsearchIndexName: indexES,
      rootCategoryId: parseInt(process.env.PIMCORE_ROOT_CATEGORY),
      assetsPath: process.env.IMAGES_ASSET_PATH,
      locale: process.env.PIMCORE_LG_VERSION || 'en_GB',
      productClass: 'Product',
      categoryClass: 'ProductCategory'
    }
    if (!validUrl.isUri(configuration.pimcoreUrl)){
      resolve({ success: false, message: 'Incorrect Pimcore url'})
    }
    pimcoreUrl = configuration.pimcoreUrl
    api = new PimcoreApiClient({
      url: pimcoreUrl,
      apiKey: configuration.apiKey
    })

    try {
      api.get('classes').end((resp) => {
        if (resp.body.success == false) {
          resolve({ success: false, message: resp.body.msg })
        } else {
          availablePimcoreClassess = resp.body.data
          resolve({ success: true, configuration})
        }
      })
    } catch (err) {
      console.error(err)
      resolve({ success: false, message: 'Invalid Pimcore url or api key'})
    }
   })
 }

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at: Promise', p, 'reason:', reason)
   // application specific logging, throwing an error, or other logic here
})

/**
 * Predefine class static variables
 */
Abstract.logsWereCreated = false
Abstract.infoLogStream = '/dev/null'
Abstract.logStream = '/dev/null'

if (require.main.filename === __filename) {
  /**
   * Pre-loading staff
   */
  Manager.checkUserOS()
  /**
   * This is where all the magic happens
   */
  retrieveData()
    .then(async (data) => {
      if (!data || !data.success) {
        console.log(data)
        throw new Error('There was an error importing data from Pimcore')
      }
      let manager = new Manager(data.configuration)
      await manager.tryToCreateLogFiles()
      .then(manager.initPimcore.bind(manager))
      .then(manager.showGoodbyeMessage.bind(manager))
      .catch(Message.error)
    })
} else {
  module.exports.Message = Message
  module.exports.Manager = Manager
  module.exports.Abstract = Abstract
  module.exports.TARGET_CONFIG_FILE = TARGET_CONFIG_FILE
}
