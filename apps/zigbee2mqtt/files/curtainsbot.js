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
    zigbeeModel: ["TS030F"],
    // The model identifier from the manufacturer data in the image.
    model: "ADCBZI01",
    // The vendor of the device.
    vendor: "Moes",
    // A description of the device.
    description: "Moes Curtain Robot",
    // Add fingerprints for more robust device identification.
    // These values (manufacturerName and modelID) are taken directly from the device's
    // basic cluster attributes, as seen in the image you provided.
    fingerprints: [{
        manufacturerName: "_TZ3210_sxtfesc6",
        modelID: "TS030F",
    }],
    // Define the exposed features of the device in Zigbee2MQTT.
    exposes: [
        // Cover control with position (0-100%).
        e.cover_position(),
        // Battery percentage.
        e.battery(),
        // Light intensity, assuming DP 107 is for a light sensor.
        e.illuminance_lux(),
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
        fz.ignore_basic_cluster_report, // Ignore basic cluster reports if not needed
        fz.battery, // Standard battery reporting
        tuya.fz.datapoint({
            // DP 3: Percent state (current position)
            // Maps Tuya DP 3 to the 'position' attribute for cover.
            // Tuya reports 0-100, Zigbee2MQTT also uses 0-100 for position.
            dp: 3,
            // The type of data point, here it's a value.
            type: "value",
            // The endpoint property to be updated.
            propertyName: "position",
            // Function to convert the Tuya value to the desired Zigbee2MQTT format.
            // For cover position, 0% is closed, 100% is open.
            // Tuya's 0-100 directly maps to Zigbee2MQTT's 0-100.
            converter: (value) => {
                // Ensure value is within 0-100 range.
                return { position: value };
            },
        }),
        tuya.fz.datapoint({
            // DP 13: Battery percentage
            dp: 13,
            type: "value",
            propertyName: "battery",
            converter: (value) => {
                // Tuya reports 0-100, which directly maps to Zigbee2MQTT's battery percentage.
                return { battery: value };
            },
        }),
        tuya.fz.datapoint({
            // DP 107: Light intensity
            dp: 107,
            type: "value",
            propertyName: "illuminance_lux",
            converter: (value) => {
                // Assuming value is 0-100, convert to lux if needed, or use directly.
                // For simplicity, we'll map 0-100 to 0-100 lux.
                return { illuminance_lux: value };
            },
        }),
        tuya.fz.datapoint({
            // DP 5: Motor direction
            dp: 5,
            type: "enum",
            propertyName: "motor_direction",
            converter: (value) => {
                const motorDirectionMap = {
                    0: "none",
                    1: "left_start",
                    2: "right_start",
                    3: "completed",
                };
                return { motor_direction: motorDirectionMap[value] };
            },
        }),
        tuya.fz.datapoint({
            // DP 7: Work state
            dp: 7,
            type: "enum",
            propertyName: "work_state",
            converter: (value) => {
                const workStateMap = {
                    0: "standby",
                    1: "opening",
                    2: "closing",
                };
                return { work_state: workStateMap[value] };
            },
        }),
        tuya.fz.datapoint({
            // DP 101: Charge state
            dp: 101,
            type: "enum",
            propertyName: "charge_state",
            converter: (value) => {
                const chargeStateMap = {
                    0: "none",
                    1: "uncharged",
                    2: "charging",
                    3: "charged",
                };
                return { charge_state: chargeStateMap[value] };
            },
        }),
    ],
    // Converters for messages going FROM Zigbee2MQTT TO the device.
    toZigbee: [
        tuya.tz.datapoint({
            // DP 2: Percent control (target position)
            // Maps Zigbee2MQTT's 'position' attribute to Tuya DP 2.
            // This handles setting the curtain to a specific percentage.
            dp: 2,
            type: "value",
            propertyName: "position",
            // Function to convert the Zigbee2MQTT value to the Tuya format.
            // Zigbee2MQTT's 0-100 directly maps to Tuya's 0-100.
            converter: (value) => {
                // Ensure value is within 0-100 range.
                return Math.max(0, Math.min(100, value));
            },
        }),
        tuya.tz.datapoint({
            // DP 1: Control (open/stop/close)
            // This handles the 'open', 'close', and 'stop' commands.
            dp: 1,
            type: "enum",
            propertyName: "state",
            // Converter for 'open', 'close', 'stop' commands.
            converter: (value) => {
                switch (value) {
                    case "open":
                        return 0; // Tuya DP 1: 0 for open
                    case "close":
                        return 2; // Tuya DP 1: 2 for close
                    case "stop":
                        return 1; // Tuya DP 1: 1 for stop
                    default:
                        // No action for other states, or throw an error.
                        throw new Error(`Unsupported state: ${value}`);
                }
            },
        }),
    ],
    // Metadata for Tuya devices, mapping standard Zigbee2MQTT attributes to Tuya datapoints.
    meta: {
        // Defines the Tuya datapoint IDs for various functionalities.
        // This helps the generic Tuya converters understand how to interact with the device.
        tuyaDatapoints: [
            [e.cover_position(), 2, "value"], // Target position (set)
            [e.cover_position(), 3, "value"], // Current position (get)
            [e.battery(), 13, "value"], // Battery percentage
            [e.illuminance_lux(), 107, "value"], // Light intensity
            [e.cover_state(), 1, "enum"], // Open/Close/Stop commands
            [e.enum("motor_direction", ea.ALL, ["none", "left_start", "right_start", "completed"]), 5, "enum"],
            [e.enum("work_state", ea.ALL, ["standby", "opening", "closing"]), 7, "enum"],
            [e.enum("charge_state", ea.ALL, ["none", "uncharged", "charging", "charged"]), 101, "enum"],
        ],
    },
    // Configuration for reporting (how often the device sends updates).
    // This part might need adjustment based on the device's actual capabilities.
    // For now, we'll keep it simple, letting Tuya's internal reporting handle most.
    configure: async (device, coordinatorEndpoint, logger) => {
        // You can add specific reporting configurations here if needed.
        // For example, to request battery reports every hour:
        // const endpoint = device.getEndpoint(1);
        // await reporting.batteryPercentageRemaining(endpoint);
        logger.debug(`Configuring Moes Curtain Robot: ${device.ieeeAddr}`);
        // Ensure the device reports its state after pairing/configuration
        device.getEndpoint(1).addTuyaDataPointListener(
            (dpValue) => logger.debug(`Received Tuya DP: ${JSON.stringify(dpValue)}`),
        );
    },
};

module.exports = definition;
