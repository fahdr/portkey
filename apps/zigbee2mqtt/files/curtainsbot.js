const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const e = exposes.presets;
const ea = exposes.access;
const tuya = require('zigbee-herdsman-converters/lib/tuya');

const definition = {
        fingerprint: tuya.fingerprint('TS030F', ['_TZ3210_sxtfesc6']),
        model: 'ADCBZI01',
        vendor: 'Moes',
        description: 'Curtain Robot',
        fromZigbee: [fz.cover_position_tilt, tuya.fz.datapoints],
        toZigbee: [tz.cover_position_tilt, tz.cover_state, tuya.tz.datapoints],
        exposes: [
            e.cover_position(),
            e.position(),
            e.battery(),
            e.illuminance(),
            e.direction(),
        ],
        meta: {
            tuyaDatapoints: [
                [3, 'position', tuya.valueConverter.raw],
                [13, 'battery', tuya.valueConverter.raw],
                [107, 'illuminance', tuya.valueConverter.raw], 
                [5, 'direction', tuya.valueConverter.raw],                     
              ],
        },
};
    
module.exports = definition;