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

const exposes = require('zigbee-herdsman-converters/lib/exposes');
const ea = exposes.access;

// Manual Tuya datatype map
const datatypes = {
    raw: 0x00,
    bool: 0x01,
    value: 0x02,
    string: 0x03,
    enum: 0x04,
    bitmap: 0x05,
};

// Encode payload manually
function convertDataToPayload(datatype, value) {
    switch (datatype) {
        case 'bool':
            return Buffer.from([value ? 1 : 0]);
        case 'value': {
            const buf = Buffer.alloc(4);
            buf.writeUInt32BE(value);
            return buf;
        }
        case 'enum':
            return Buffer.from([value]);
        case 'string': {
            const strBuf = Buffer.from(value, 'utf8');
            return Buffer.concat([Buffer.from([strBuf.length]), strBuf]);
        }
        default:
            throw new Error(`Unsupported datatype: ${datatype}`);
    }
}

// Send Tuya datapoint command using dpValues array with top-level seq
const sendDataPoint = async (entity, dp, datatype, value) => {
    const seq = Math.floor(Math.random() * 255);

    const payload = {
        seq,
        dpValues: [{
            dp,
            datatype: datatypes[datatype],
            data: convertDataToPayload(datatype, value),
            seq,
        }],
    };

    await entity.command(
        'manuSpecificTuya',
        'dataRequest',
        payload,
        {},
        2,
    );
};

// fromZigbee decoder
const fromZigbeeTuyaCurtain = {
    cluster: 'manuSpecificTuya',
    type: ['commandDataResponse'],
    convert: (model, msg, publish, options, meta) => {
        const dp = msg.data.dp;
        const data = msg.data.data;
        const datatype = msg.data.datatype;

        let value;
        try {
            switch (datatype) {
                case 0x01: value = data[0] === 1; break;
                case 0x02: value = data.readUInt32BE(0); break;
                case 0x04: value = data[0]; break;
                default:
                    meta.logger.warn(`Unsupported datatype ${datatype} for DP ${dp}`);
                    return {};
            }
        } catch (err) {
            meta.logger.warn(`DP ${dp} decoding error: ${err}`);
            return {};
        }

        switch (dp) {
            case 1: {
                const map = ['open', 'stop', 'close'];
                return {control: map[value] ?? null};
            }
            case 2: return {percent_control: value};
            case 3: return {percent_state: value};
            case 5: return {motor_direction: value === 0 ? 'forward' : 'reverse'};
            case 7: {
                const map = ['opening', 'closing', 'stopped'];
                return {work_state: map[value] ?? null};
            }
            case 13: return {battery_percentage: value};
            case 101: return {charge_state: value ? 'charging' : 'not_charging'};
            case 12: return {fault: value};
            case 10: return {total_time: value};
            default:
                meta.logger.debug(`Unmapped DP: ${dp}, value: ${value}`);
                return {};
        }
    },
};

// toZigbee encoder
const toZigbeeTuyaCurtain = {
    key: ['control', 'percent_control', 'motor_direction'],
    convertSet: async (entity, key, value, meta) => {
        switch (key) {
            case 'control': {
                const map = {'open': 0, 'stop': 1, 'close': 2};
                await sendDataPoint(entity, 1, 'enum', map[value]);
                return {state: value};
            }
            case 'percent_control':
                await sendDataPoint(entity, 2, 'value', value);
                return {percent_control: value};
            case 'motor_direction':
                await sendDataPoint(entity, 5, 'enum', value === 'reverse' ? 1 : 0);
                return {motor_direction: value};
            default:
                throw new Error(`Unsupported key: ${key}`);
        }
    },
};

module.exports = {
    fingerprint: require('zigbee-herdsman-converters/lib/tuya').fingerprint('TS030F', ['_TZ3210_sxtfesc6']),
    model: 'ADCBZI01',
    vendor: 'Moes',
    description: 'Battery-operated Zigbee curtain robot (Tuya-based)',
    fromZigbee: [fromZigbeeTuyaCurtain],
    toZigbee: [toZigbeeTuyaCurtain],
    exposes: [
        exposes.enum('control', ea.SET, ['open', 'stop', 'close']).withDescription('Curtain control'),
        exposes.numeric('percent_control', ea.SET).withValueMin(0).withValueMax(100).withUnit('%').withDescription('Set curtain position'),
        exposes.numeric('percent_state', ea.STATE).withValueMin(0).withValueMax(100).withUnit('%').withDescription('Curtain position feedback'),
        exposes.enum('motor_direction', ea.SET, ['forward', 'reverse']).withDescription('Motor direction'),
        exposes.enum('work_state', ea.STATE, ['opening', 'closing', 'stopped']).withDescription('Current activity'),
        exposes.numeric('battery_percentage', ea.STATE).withUnit('%').withDescription('Battery level'),
        exposes.enum('charge_state', ea.STATE, ['charging', 'not_charging']).withDescription('Charging status'),
        exposes.numeric('fault', ea.STATE).withDescription('Device fault code'),
        exposes.numeric('total_time', ea.STATE).withUnit('s').withDescription('Total operating time'),
    ],
};