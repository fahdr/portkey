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
            e.enum('motor_direction', ea.STATE, ['forward', 'reverse']).withDescription('Motor rotation direction'),
            e.enum('work_state', ea.STATE, ['idle', 'opening', 'closing', 'stopped']).withDescription('Current work state'),
            e.numeric('total_time', ea.STATE).withUnit('s').withDescription('Total operation time'),
            e.enum('situation', ea.STATE, ['normal', 'blocked', 'limit_reached']).withDescription('Current situation'),
            e.enum('fault', ea.STATE, ['none', 'motor_fault', 'sensor_fault', 'power_fault']).withDescription('Fault status'),
            e.enum('charging_status', ea.STATE, ['not_charging', 'charging', 'charged']).withDescription('Charging status'),
            e.numeric('open_threshold', ea.STATE_SET).withValueMin(0).withValueMax(100).withDescription('Light threshold for opening'),
            e.numeric('close_threshold', ea.STATE_SET).withValueMin(0).withValueMax(100).withDescription('Light threshold for closing'),
            e.enum('robot_status', ea.STATE, ['normal', 'calibrating', 'error']).withDescription('Robot status'),
            e.numeric('total_distance', ea.STATE).withUnit('m').withDescription('Total distance traveled'),
            e.numeric('custom_week_prog_1', ea.STATE_SET).withDescription('Custom week program 1'),
            e.numeric('custom_week_prog_2', ea.STATE_SET).withDescription('Custom week program 2'),
            e.numeric('custom_week_prog_3', ea.STATE_SET).withDescription('Custom week program 3'),
            e.numeric('custom_week_prog_4', ea.STATE_SET).withDescription('Custom week program 4'),
            e.numeric('production_test', ea.STATE).withDescription('Production test feedback'),
        ],
        meta: {
            tuyaDatapoints: [
                [1, 'state', tuya.valueConverter.onOff], // Control - open/close command
                [2, 'position', tuya.valueConverter.coverPosition], // Percent control - set position
                [3, 'position', tuya.valueConverter.coverPosition], // Percent state - current position
                [5, 'motor_direction', tuya.valueConverter.raw], // Motor direction - changed to raw for debugging
                [7, 'work_state', tuya.valueConverter.raw], // Work state - changed to raw for debugging
                [10, 'total_time', tuya.valueConverter.raw], // Total time
                [11, 'situation', tuya.valueConverterBasic.lookup({'normal': 0, 'blocked': 1, 'limit_reached': 2})], // Situation
                [12, 'fault', tuya.valueConverterBasic.lookup({'none': 0, 'motor_fault': 1, 'sensor_fault': 2, 'power_fault': 3})], // Fault
                [13, 'battery', tuya.valueConverter.raw], // Battery percentage
                [101, 'charging_status', tuya.valueConverterBasic.lookup({'not_charging': 0, 'charging': 1, 'charged': 2})], // Charging status
                [103, 'custom_week_prog_1', tuya.valueConverter.raw], // Custom week program 1
                [104, 'custom_week_prog_2', tuya.valueConverter.raw], // Custom week program 2
                [105, 'custom_week_prog_3', tuya.valueConverter.raw], // Custom week program 3
                [106, 'custom_week_prog_4', tuya.valueConverter.raw], // Custom week program 4
                [107, 'illuminance', tuya.valueConverter.raw], // Lightness
                [108, 'open_threshold', tuya.valueConverter.raw], // Open window threshold
                [109, 'close_threshold', tuya.valueConverter.raw], // Close window threshold
                [110, 'robot_status', tuya.valueConverterBasic.lookup({'normal': 0, 'calibrating': 1, 'error': 2})], // Robot status
                [111, 'production_test', tuya.valueConverter.raw], // Production test feedback
                [112, 'total_distance', tuya.valueConverter.raw], // Total running distance in meters
            ],
        },
};

module.exports = definition;
