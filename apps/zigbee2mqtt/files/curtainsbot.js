// const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
// const tz = require('zigbee-herdsman-converters/converters/toZigbee');
// const exposes = require('zigbee-herdsman-converters/lib/exposes');
// const e = exposes.presets;
// const ea = exposes.access;
// const tuya = require('zigbee-herdsman-converters/lib/tuya');

// const definition = {
//         fingerprint: tuya.fingerprint('TS030F', ['_TZ3210_sxtfesc6']),
//         model: 'ADCBZI01',
//         vendor: 'Moes',
//         description: 'Curtain Robot',
//         fromZigbee: [fz.cover_position_tilt, tuya.fz.datapoints],
//         toZigbee: [tz.cover_position_tilt, tz.cover_state, tuya.tz.datapoints],
//         exposes: [
//             e.cover_position(),
//             e.position(),
//             e.battery(),
//             e.illuminance(),
//         ],
//         meta: {
//             tuyaDatapoints: [
//                 [3, 'position', tuya.valueConverter.raw],
//                 [13, 'battery', tuya.valueConverter.raw],
//                 [107, 'illuminance', tuya.valueConverter.raw],
//               ],
//         },
// };

// module.exports = definition;

// const exposes = require('zigbee-herdsman-converters/lib/exposes');
// const ea = exposes.access;

// // Safe logging wrapper
// const safeLog = (meta, level, message) => {
//     if (meta && meta.logger && typeof meta.logger[level] === 'function') {
//         meta.logger[level](message);
//     }
// };

// // Manual Tuya datatype map
// const datatypes = {
//     raw: 0x00,
//     bool: 0x01,
//     value: 0x02,
//     string: 0x03,
//     enum: 0x04,
//     bitmap: 0x05,
// };

// // Encode payload manually
// function convertDataToPayload(datatype, value) {
//     switch (datatype) {
//         case 'bool':
//             return Buffer.from([value ? 1 : 0]);
//         case 'value': {
//             const buf = Buffer.alloc(4);
//             buf.writeUInt32BE(value);
//             return buf;
//         }
//         case 'enum':
//             return Buffer.from([value]);
//         case 'string': {
//             const strBuf = Buffer.from(value, 'utf8');
//             return Buffer.concat([Buffer.from([strBuf.length]), strBuf]);
//         }
//         default:
//             throw new Error(`Unsupported datatype: ${datatype}`);
//     }
// }

// // Send Tuya datapoint command using dpValues array with top-level seq
// const sendDataPoint = async (entity, dp, datatype, value) => {
//     const seq = Math.floor(Math.random() * 255);

//     const payload = {
//         seq,
//         dpValues: [{
//             dp,
//             datatype: datatypes[datatype],
//             data: convertDataToPayload(datatype, value),
//             seq,
//         }],
//     };

//     await entity.command(
//         'manuSpecificTuya',
//         'dataRequest',
//         payload,
//         {},
//         2,
//     );
// };

// // fromZigbee decoder
// const fromZigbeeTuyaCurtain = {
//     cluster: 'manuSpecificTuya',
//     type: ['commandDataResponse'],
//     convert: (model, msg, publish, options, meta) => {
//         const dp = msg.data.dp;
//         const data = msg.data.data;
//         const datatype = msg.data.datatype;

//         let value;
//         try {
//             switch (datatype) {
//                 case 0x01: value = data[0] === 1; break;
//                 case 0x02: value = data.readUInt32BE(0); break;
//                 case 0x04: value = data[0]; break;
//                 default:
//                     safeLog(meta, 'warn', `Unsupported datatype ${datatype} for DP ${dp}`);
//                     return {};
//             }
//         } catch (err) {
//             safeLog(meta, 'warn', `DP ${dp} decoding error: ${err}`);
//             return {};
//         }

//         safeLog(meta, 'debug', `Decoded DP ${dp} (type ${datatype}) with value: ${value}`);

//         switch (dp) {
//             case 1: {
//                 const map = ['open', 'stop', 'close'];
//                 const result = map[value];
//                 return {control: typeof result === 'string' ? result : null};
//             }
//             case 2: return {percent_control: value};
//             case 3: return {percent_state: value};
//             case 5: return {motor_direction: value === 0 ? 'forward' : 'reverse'};
//             case 7: {
//                 const map = ['opening', 'closing', 'stopped'];
//                 const result = map[value];
//                 return {work_state: typeof result === 'string' ? result : null};
//             }
//             case 13: return {battery_percentage: value};
//             case 101: return {charge_state: value ? 'charging' : 'not_charging'};
//             case 12: return {fault: value};
//             case 10: return {total_time: value};
//             default:
//                 safeLog(meta, 'debug', `Unmapped DP: ${dp}, value: ${value}`);
//                 return {};
//         }
//     },
// };

// // toZigbee encoder
// const toZigbeeTuyaCurtain = {
//     key: ['control', 'percent_control', 'motor_direction'],
//     convertSet: async (entity, key, value, meta) => {
//         safeLog(meta, 'debug', `Sending '${key}' with value '${value}'`);
//         switch (key) {
//             case 'control': {
//                 const map = {'open': 0, 'stop': 1, 'close': 2};
//                 await sendDataPoint(entity, 1, 'enum', map[value]);
//                 return {state: value};
//             }
//             case 'percent_control':
//                 await sendDataPoint(entity, 2, 'value', value);
//                 return {percent_control: value};
//             case 'motor_direction':
//                 await sendDataPoint(entity, 5, 'enum', value === 'reverse' ? 1 : 0);
//                 return {motor_direction: value};
//             default:
//                 throw new Error(`Unsupported key: ${key}`);
//         }
//     },
// };

// module.exports = {
//     fingerprint: require('zigbee-herdsman-converters/lib/tuya').fingerprint('TS030F', ['_TZ3210_sxtfesc6']),
//     model: 'ADCBZI01',
//     vendor: 'Moes',
//     description: 'Battery-operated Zigbee curtain robot (Tuya-based)',
//     fromZigbee: [fromZigbeeTuyaCurtain],
//     toZigbee: [toZigbeeTuyaCurtain],
//     exposes: [
//         exposes.enum('control', ea.SET, ['open', 'stop', 'close']).withDescription('Curtain control'),
//         exposes.numeric('percent_control', ea.SET).withValueMin(0).withValueMax(100).withUnit('%').withDescription('Set curtain position'),
//         exposes.numeric('percent_state', ea.STATE).withValueMin(0).withValueMax(100).withUnit('%').withDescription('Curtain position feedback'),
//         exposes.enum('motor_direction', ea.SET, ['forward', 'reverse']).withDescription('Motor direction'),
//         exposes.enum('work_state', ea.STATE, ['opening', 'closing', 'stopped']).withDescription('Current activity'),
//         exposes.numeric('battery_percentage', ea.STATE).withUnit('%').withDescription('Battery level'),
//         exposes.enum('charge_state', ea.STATE, ['charging', 'not_charging']).withDescription('Charging status'),
//         exposes.numeric('fault', ea.STATE).withDescription('Device fault code'),
//         exposes.numeric('total_time', ea.STATE).withUnit('s').withDescription('Total operating time'),
//     ],
// };

// const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
// const tz = require('zigbee-herdsman-converters/converters/toZigbee');
// const exposes = require('zigbee-herdsman-converters/lib/exposes');
// const e = exposes.presets;
// const ea = exposes.access;
// const tuya = require('zigbee-herdsman-converters/lib/tuya');

// module.exports = {
//     fingerprint: tuya.fingerprint('TS030F', ['_TZ3210_sxtfesc6']),
//     model: 'ADCBZI01',
//     vendor: 'Moes',
//     description: 'Curtain Robot (Hybrid Tuya + Zigbee)',
//     fromZigbee: [fz.cover_position_tilt, tuya.fz.datapoints],
//     toZigbee: [tz.cover_position_tilt, tz.cover_state, tuya.tz.datapoints],
//     configure: tuya.configureMagicPacket,
//     exposes: [
//         e.cover_position(), // Standard cover control
//         e.position(),       // Position slider
//         e.battery(),        // Battery percentage
//         e.illuminance(),    // Ambient light
//         exposes.enum('motor_direction', ea.SET, ['forward', 'reverse']).withDescription('Motor direction'),
//         exposes.enum('work_state', ea.STATE, ['opening', 'closing', 'stopped']).withDescription('Current activity'),
//     ],
//     meta: {
//         tuyaDatapoints: [
//             [3, 'position', tuya.valueConverter.raw],           // Position feedback
//             [13, 'battery', tuya.valueConverter.raw],           // Battery level
//             [107, 'illuminance', tuya.valueConverter.raw],      // Light sensor
//             [5, 'motor_direction', tuya.valueConverterBasic.lookup({forward: 0, reverse: 1})],
//             [7, 'work_state', tuya.valueConverterBasic.lookup({opening: 0, closing: 1, stopped: 2})],
//         ],
//     },
// };

// moes_curtain_robot.js
const fz = require("zigbee-herdsman-converters/converters/fromZigbee");
const exposes = require("zigbee-herdsman-converters/lib/exposes");
const reporting = require("zigbee-herdsman-converters/lib/reporting");
const tuya = require("zigbee-herdsman-converters/lib/tuya");
const e = exposes.presets;
const ea = exposes.access;

const definition = {
    // The zigbeeModel is typically found in the device's Zigbee information.
    // Based on the provided image, it's 'TS0601'.
    // The model identifier from the manufacturer data in the image.
    model: "ADCBZI01",
    // The vendor of the device.
    vendor: "Moes",
    // A description of the device.
    description: "Moes Curtain Robot",
    // Add fingerprints for more robust device identification.
    // These values (manufacturerName and modelID) are taken directly from the device's
    // basic cluster attributes, as seen in the image you provided.
    fingerprint: tuya.fingerprint('TS030F', ['_TZ3210_sxtfesc6']),

    // Define the exposed features of the device in Zigbee2MQTT.
    exposes: [
        // Cover control with position (0-100%).
        e.cover_position(),
        // Battery percentage.
        e.battery(),
        // Light intensity, assuming DP 107 is for a light sensor.
        e.illuminance(),
        // Add a motor direction switch if needed, mapped to DP 5
        e.enum("motor_direction", ea.ALL, ["none", "left_start", "right_start", "completed"])
            .withDescription("Reports motor direction status."),
        // Add work state
        e.enum("work_state", ea.ALL, ["standby", "opening", "closing"])
            .withDescription("Reports the current work state of the motor."),
        // Add charge state
        e.enum("charge_state", ea.ALL, ["none", "uncharged", "charging", "charged"])
            .withDescription("Reports the charging status of the device."),
    ],
    // Converters for messages coming FROM the device TO Zigbee2MQTT.
    fromZigbee: [
        fz.ignore_basic_report, // Ignore basic cluster reports if not needed
        fz.battery, // Standard battery reporting
        tuya.fz.datapoints,
    ],
    // Converters for messages going FROM Zigbee2MQTT TO the device.
    toZigbee: [
        tuya.tz.datapoints,
    ],
    // Metadata for Tuya devices, mapping standard Zigbee2MQTT attributes to Tuya datapoints.
    meta: {
        // This array is crucial. It tells the generic tuya.fz.datapoints and tuya.tz.datapoints
        // how to map Zigbee2MQTT attributes to Tuya Data Points (DPs).
        tuyaDatapoints: [
            // [exposes_preset, Tuya_DP_ID, Tuya_DP_Type]
            [e.cover_position(), 2, "value"], // Target position (set) - DP 2: Percent control
            [e.cover_position(), 3, "value"], // Current position (get) - DP 3: Percent state
            [e.battery(), 13, "value"], // Battery percentage - DP 13: Battery percentage
            [e.illuminance(), 107, "value"], // Light intensity - DP 107: Lightness
            // Custom enums for additional datapoints
            [e.enum("motor_direction", ea.ALL, ["none", "left_start", "right_start", "completed"]), 5, "enum"], // DP 5: Motor direction
            [e.enum("work_state", ea.ALL, ["standby", "opening", "closing"]), 7, "enum"], // DP 7: Work state
            [e.enum("charge_state", ea.ALL, ["none", "uncharged", "charging", "charged"]), 101, "enum"], // DP 101: Charge state
        ],
    },
    // Configuration for reporting (how often the device sends updates).
    configure: async (device, coordinatorEndpoint, logger) => {
        logger.debug(`Configuring Moes Curtain Robot: ${device.ieeeAddr}`);
        // The generic Tuya datapoints converter will handle most of the reporting.
        // You can add specific reporting configurations here if needed,
        // for example, to request battery reports every hour:
        const endpoint = device.getEndpoint(1); // Get the primary endpoint
        await reporting.batteryPercentageRemaining(endpoint); // Add an await expression here
        device.getEndpoint(1).addTuyaDataPointListener(
            (dpValue) => logger.debug(`Received Tuya DP: ${JSON.stringify(dpValue)}`),
        );
    },
};

module.exports = definition;
