'use strict'

var HomeKitGenericService = require('./HomeKitGenericService.js').HomeKitGenericService
var util = require('util')

function HomeMaticHomeKitGarageDoorService (log, platform, id, name, type, adress, special, cfg, Service, Characteristic) {
  HomeMaticHomeKitGarageDoorService.super_.apply(this, arguments)
}

util.inherits(HomeMaticHomeKitGarageDoorService, HomeKitGenericService)

HomeMaticHomeKitGarageDoorService.prototype.propagateServices = function (homebridge, Service, Characteristic) {

  // Register new Characteristic or Services here

}

HomeMaticHomeKitGarageDoorService.prototype.createDeviceService = function (Service, Characteristic) {
  let that = this
  this.usecache = false
  this.characteristic = Characteristic

  this.address_sensor_close = this.getClazzConfigValue('address_sensor_close', undefined)
  this.address_sensor_open = this.getClazzConfigValue('address_sensor_open', undefined)

  this.state_sensor_close = this.getClazzConfigValue('state_sensor_close', true)
  this.state_sensor_open = this.getClazzConfigValue('state_sensor_open', true)

  this.address_actor_open = this.getClazzConfigValue('address_actor_open', undefined)
  this.address_actor_close = this.getClazzConfigValue('address_actor_close', undefined)

  this.delay_actor_open = this.getClazzConfigValue('delay_actor_open', 5)
  this.delay_actor_close = this.getClazzConfigValue('delay_actor_close', 5)

  this.message_actor_open = this.getClazzConfigValue('message_actor_open', {
    'on': 1,
    'off': 0
  })
  this.message_actor_close = this.getClazzConfigValue('message_actor_close', {
    'on': 1,
    'off': 0
  })

  this.sensor_requery_time = this.getClazzConfigValue('sensor_requery_time', 30)

  // show configuration
  let twoSensorMode = ((this.address_sensor_close !== undefined) && (this.address_sensor_open !== undefined))
  this.log.info('Garage Door Config: %s sensor mode', twoSensorMode ? 'two' : 'one')
  if (twoSensorMode) {
    this.log.info('Sensor open  is %s', this.address_sensor_open)
    this.log.info('Sensor open value is %s', this.state_sensor_open)
  }
  this.log.info('Sensor close  is %s', this.address_sensor_close)
  this.log.info('Sensor close value is %s', this.state_sensor_close)

  this.targetCommand = false

  // validate stuff
  if (this.isDatapointAddressValid(this.address_sensor_close, false) === false) {
    this.log.error('cannot initialize garage device adress for close sensor is invalid')
    return
  }

  if (this.isDatapointAddressValid(this.address_sensor_open, true) === false) {
    this.log.error('cannot initialize garage device adress for open sensor is invalid')
    return
  }

  if (this.isDatapointAddressValid(this.address_actor_open, false) === false) {
    this.log.error('cannot initialize garage device adress for open actor is invalid')
    return
  }

  if (this.isDatapointAddressValid(this.address_actor_close, true) === false) {
    this.log.error('cannot initialize garage device adress for close actor is invalid')
    return
  }

  var garagedoorService = new Service.GarageDoorOpener(this.name)
  this.services.push(garagedoorService)

  this.obstacle = garagedoorService.getCharacteristic(Characteristic.ObstructionDetected)
    .on('get', function (callback) {
      if (callback) callback(null, false)
    })

  this.currentDoorState = garagedoorService.getCharacteristic(Characteristic.CurrentDoorState)

    .on('get', function (callback) {
      var returnValue = Characteristic.CurrentDoorState.STOPPED

      if ((that.address_sensor_close !== undefined) && (that.address_sensor_open !== undefined)) {
        // We have two contacts so ask for boath levels
        that.log.debug('Two sensor mode. Fetching value for Close Sensor %s', that.address_sensor_close)
        that.remoteGetDataPointValue(that.address_sensor_close, function (closeValue) {
          that.log.debug('get close value result is %s', closeValue)
          that.log.debug('Fetching value for Open Sensor %s', that.address_sensor_close)
          that.remoteGetDataPointValue(that.address_sensor_open, function (openValue) {
            that.log.debug('get open value result is %s', openValue)

            if ((that.didMatch(closeValue, that.state_sensor_close)) && (!that.didMatch(openValue, that.state_sensor_open))) {
              that.log.debug('values shows CurrentDoorState is closed')
              returnValue = Characteristic.CurrentDoorState.CLOSED
              if (that.targetCommand) {
                that.targetDoorState.updateValue(that.characteristic.TargetDoorState.CLOSED, null)
              }
            }

            if ((!that.didMatch(closeValue, that.state_sensor_close)) && (!that.didMatch(openValue, that.state_sensor_open))) {
              returnValue = Characteristic.CurrentDoorState.OPENING // or closing its moving
            }

            if ((!that.didMatch(closeValue, that.state_sensor_close)) && (that.didMatch(openValue, that.state_sensor_open))) {
              returnValue = Characteristic.CurrentDoorState.OPEN
              if (that.targetCommand) {
                that.targetDoorState.updateValue(that.characteristic.TargetDoorState.OPEN, null)
              }
            }

            if (callback) callback(null, returnValue)
          })
        })
      }

      if ((that.address_sensor_close !== undefined) && (that.address_sensor_open === undefined)) {
        // There is only one contact
        that.log.debug('One sensor mode. Fetching value for Close Sensor %s', that.address_sensor_close)
        that.remoteGetDataPointValue(that.address_sensor_close, function (closeValue) {
          that.log.debug('get close value result is %s', closeValue)
          if (that.didMatch(closeValue, that.state_sensor_close)) {
            that.log.debug('values match close state')
            returnValue = Characteristic.CurrentDoorState.CLOSED
          } else {
            that.log.debug('values %s vs %s did not match close state set door to open', closeValue, that.state_sensor_close)
            returnValue = Characteristic.CurrentDoorState.OPEN
          }
          if (callback) callback(null, returnValue)
        })
      }
    })

  this.targetDoorState = garagedoorService.getCharacteristic(Characteristic.TargetDoorState)
    .on('set', function (value, callback) {
      that.targetCommand = true

      clearTimeout(this.requeryTimer)

      if ((that.address_actor_open !== undefined) && (that.address_actor_close === undefined)) {
        // there is only one actor
        if (value === Characteristic.TargetDoorState.OPEN) {
          that.currentDoorState.updateValue(that.characteristic.CurrentDoorState.OPENING, null)
        } else {
          that.currentDoorState.updateValue(that.characteristic.CurrentDoorState.CLOSING, null)
        }

        that.sendActorMessage(that.address_actor_open, that.message_actor_open['on'])
        that.sendActorMessage(that.address_actor_open, that.message_actor_open['off'], that.delay_actor_open)

        that.requeryTimer = setTimeout(function () {
          // reset Command Switch to override target
          that.targetCommand = false
          that.log.debug('garage door requery sensors ...')
          that.querySensors()
        }, 1000 * that.sensor_requery_time)
      } else {
        // there is a actor for every direction so
        if (value === Characteristic.TargetDoorState.OPEN) {
          that.currentDoorState.updateValue(that.characteristic.CurrentDoorState.OPENING, null)

          that.sendActorMessage(that.address_actor_open, that.message_actor_open['on'])
          that.sendActorMessage(that.address_actor_open, that.message_actor_open['off'], that.delay_actor_open)
          // reset Command Switch to override target
          that.targetCommand = false
          that.requeryTimer = setTimeout(function () {
            that.log.debug('garage door requery sensors ...')
            that.querySensors()
          }, 1000 * that.sensor_requery_time)
        } else {
          that.currentDoorState.updateValue(that.characteristic.CurrentDoorState.CLOSING, null)
          that.sendActorMessage(that.address_actor_close, that.message_actor_close['on'])
          that.sendActorMessage(that.address_actor_close, that.message_actor_close['off'], that.delay_actor_close)

          // reset Command Switch to override target
          that.targetCommand = false
          that.requeryTimer = setTimeout(function () {
            that.log.debug('garage door requery sensors ...')
            that.querySensors()
          }, 1000 * that.sensor_requery_time)
        }
      }
      if (callback) callback()
    }.bind(this))

  this.currentDoorState.eventEnabled = true
  // register for status events
  this.platform.registerAdressForEventProcessingAtAccessory(this.address_sensor_close, this)
  this.platform.registerAdressForEventProcessingAtAccessory(this.address_sensor_open, this)
  // this is dirty shit .. ¯\_(ツ)_/¯  it works so we do not change that ...
  // query sensors at launch delayed by 60 seconds
  setTimeout(function () {
    that.log.debug('garage door inital query ...')
    that.querySensors()
  }, 60000)
}

HomeMaticHomeKitGarageDoorService.prototype.sendActorMessage = function (address, message, delay) {
  let that = this
  if ((message !== undefined) && (address !== undefined)) {
    if (delay === undefined) {
      this.remoteSetDatapointValue(address, message)
    } else {
      setTimeout(function () {
        that.remoteSetDatapointValue(address, message)
      }, 1000 * delay)
    }
  }
}

HomeMaticHomeKitGarageDoorService.prototype.querySensors = function () {
  let that = this

  if (this.address_sensor_close !== undefined) {
    that.remoteGetDataPointValue(that.address_sensor_close, function (newValue) {
      that.log.debug('result for close sensor %s', newValue)
      let parts = that.address_sensor_close.split('.')
      that.event(parts[0] + '.' + parts[1], parts[2], newValue)
    })
  }

  if (this.address_sensor_open !== undefined) {
    this.remoteGetDataPointValue(that.address_sensor_open, function (newValue) {
      that.log.debug('result for open sensor %s', newValue)
      let parts = that.address_sensor_close.split('.')
      that.event(parts[0] + '.' + parts[1], parts[2], newValue)
    })
  }
}

HomeMaticHomeKitGarageDoorService.prototype.event = function (channel, dp, newValue) {
  // Chech sensors
  let that = this
  this.log.debug('garage event %s,%s,%s Target Command State %s', channel, dp, newValue, this.targetCommand)
  let eventAddress = channel + '.' + dp
  // Kill requery timer
  clearTimeout(this.requeryTimer)

  if ((this.address_sensor_close !== undefined) && (this.address_sensor_open !== undefined)) {
    // we have two sensors
    this.log.debug('Two Sensor Mode')
    if ((eventAddress === this.address_sensor_close) && (newValue === this.state_sensor_close)) {
      // Sensor Close said its closed
      this.log.debug('close sensor is %s set CurrentDoorState to close', newValue)
      this.currentDoorState.updateValue(this.characteristic.CurrentDoorState.CLOSED, null)
      this.targetCommand = false
    }

    if ((eventAddress === this.address_sensor_close) && (newValue !== this.state_sensor_close)) {
      // Sensor Close just opened so the door is moving to open position
      this.log.debug('close sensor is %s set TargetDoorState to open CurrentDoorState to opening', newValue)
      if (this.targetCommand) {
        this.targetDoorState.updateValue(this.characteristic.TargetDoorState.OPEN)
      }
      this.currentDoorState.updateValue(this.characteristic.CurrentDoorState.OPENING, null)
    }

    if ((eventAddress === this.address_sensor_open) && (newValue === this.state_sensor_open)) {
      // Sensor Open said its open
      this.log.debug('open sensor is %s set CurrentDoorState to open', newValue)
      this.currentDoorState.updateValue(this.characteristic.CurrentDoorState.OPEN, null)
      this.targetCommand = false
    }

    if ((eventAddress === this.address_sensor_open) && (newValue !== this.state_sensor_open)) {
      // Sensor open just went to false so the door is moving to close position
      this.log.debug('open sensor is %s set TargetDoorState to close CurrentDoorState to closing', newValue)
      if (this.targetCommand) {
        this.targetDoorState.updateValue(this.characteristic.TargetDoorState.CLOSED)
      }
      this.currentDoorState.updateValue(this.characteristic.CurrentDoorState.CLOSING, null)
    }
  } else {
    this.log.debug('One Sensor Mode Close is %s', that.state_sensor_close)
    // we only have one sensor if its the close sensor the door is closed on sensor true
    if (eventAddress === this.address_sensor_close) {
      // first set a new target state but ony if the target was not set by homekit first
      if (this.targetCommand === false) {
        let newState = (newValue === that.state_sensor_close) ? this.characteristic.TargetDoorState.CLOSED : this.characteristic.TargetDoorState.OPEN
        this.log.debug('Close sensor is %s set targetDoorState %s', newValue, newState)
        this.targetDoorState.updateValue(newState, null)
      }
      // wait one second cause we have a really fast going garage door
      setTimeout(function () {
        let newState = (newValue === that.state_sensor_close) ? that.characteristic.CurrentDoorState.CLOSED : that.characteristic.CurrentDoorState.OPEN
        that.log.debug('timer fired close sensor is %s set new current state %s', newState, newState)
        that.currentDoorState.updateValue(newState, null)
      }, 1000)
    }

    if (eventAddress === this.address_sensor_open) {
      if (this.targetCommand === false) {
        let newState = (newValue === this.state_sensor_open) ? that.characteristic.TargetDoorState.OPEN : this.characteristic.TargetDoorState.CLOSED
        this.log.debug('open sensor is %s set new target state %s', newValue, newState)
        this.targetDoorState.updateValue(newState, null)
      }

      setTimeout(function () {
        let newState = (newValue === that.state_sensor_open) ? that.characteristic.CurrentDoorState.OPEN : that.characteristic.CurrentDoorState.CLOSED
        that.log.debug('fired open sensor is %s set new state %s', newValue, newState)
        that.currentDoorState.updateValue(newState, null)
      }, 1000)
    }

    this.targetCommand = false
  }
}

module.exports = HomeMaticHomeKitGarageDoorService
