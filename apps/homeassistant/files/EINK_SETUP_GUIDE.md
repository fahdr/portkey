# Eink Dashboard Setup Guide

This guide will help you set up a Home Assistant dashboard optimized for eink displays.

## Files Overview

1. **eink-homescreen** - The main dashboard configuration
2. **eink-configuration.yaml** - Home Assistant entities, scripts, and automations
3. **eink-theme.yaml** - Custom theme optimized for eink displays
4. **eink-styles.css** - Additional CSS styling for better eink rendering

## Setup Instructions

### Step 1: Configure Home Assistant

1. Copy the content from `eink-configuration.yaml` to your Home Assistant configuration
2. You can either:
   - Add it directly to your `configuration.yaml` file
   - Create a package file in `packages/eink.yaml` (recommended)
   - Include individual sections in their respective files

### Step 2: Install the Theme

1. Create a `themes` folder in your Home Assistant config directory if it doesn't exist
2. Copy `eink-theme.yaml` to the `themes` folder
3. Add the following to your `configuration.yaml`:
   ```yaml
   frontend:
     themes: !include_dir_named themes
   ```
4. Restart Home Assistant

### Step 3: Add Custom CSS

1. Create a `www` folder in your Home Assistant config directory if it doesn't exist
2. Copy `eink-styles.css` to the `www` folder
3. Add the following to your `configuration.yaml`:
   ```yaml
   frontend:
     extra_module_url:
       - /local/eink-styles.css
   ```

### Step 4: Create the Dashboard

1. In Home Assistant, go to Configuration > Dashboards
2. Click "Add Dashboard"
3. Choose "New dashboard from scratch"
4. Set the title to "Eink Control Panel"
5. Switch to YAML mode and paste the content from `eink-homescreen`
6. Save the dashboard

### Step 5: Customize Entity Names

Update the following entity IDs in the configuration to match your actual devices:

#### Curtains
- `cover.living_room_curtain_left` - Your left living room curtain
- `cover.living_room_curtain_right` - Your right living room curtain
- `cover.bedroom_curtain_left` - Your left bedroom curtain
- `cover.bedroom_curtain_right` - Your right bedroom curtain

#### Lights
- `light.light_set_1_bulb_1` - First bulb in set 1
- `light.light_set_1_bulb_2` - Second bulb in set 1
- `light.light_set_1_bulb_3` - Third bulb in set 1
- `light.light_set_2_bulb_1` - First bulb in set 2
- `light.light_set_2_bulb_2` - Second bulb in set 2
- `light.light_set_2_bulb_3` - Third bulb in set 2
- `light.dining_room` - Your dining room light
- `light.hallway` - Your hallway light

#### Temperature Sensors
- `sensor.external_temperature` - Your external temperature sensor
- `sensor.internal_temperature` - Your internal temperature sensor

#### SwitchBot
- `switch.switchbot_ac_controller` - Your SwitchBot device controlling the AC

### Step 6: Configure Your Eink Device

1. Set your eink device to display the dashboard URL:
   ```
   http://your-home-assistant-ip:8123/eink-dashboard
   ```
2. Configure the device to use the eink theme
3. Set refresh rate appropriately for your eink display (typically 30 seconds to 5 minutes)

## Features

### Curtain Control
- Individual control for each curtain
- Sync both curtains in a pair
- Quick actions for all curtains

### Lighting Control
- Individual bulb control within sets
- Group control for each set
- Room-specific controls
- "All lights off" quick action

### Climate Control
- External temperature monitoring
- AC control via SwitchBot
- Automatic temperature-based AC control
- Manual override options

### Quick Actions
- All lights off
- Close all curtains
- Good night mode (combines multiple actions)

## Customization Tips

### Eink-Specific Optimizations
- High contrast black/white theme
- No animations or transitions
- Large, readable fonts
- Clear button borders
- Minimal refresh requirements

### Adding More Devices
To add more devices, follow this pattern:

1. Add the entity to the dashboard YAML
2. Include it in relevant groups in the configuration
3. Add it to automation scripts if needed

### Screen Size Optimization
The CSS includes responsive design for common eink screen sizes:
- 4.2" displays (400x300)
- 7.5" displays (800x480)
- 13.3" displays (1600x1200)

### Refresh Rate Recommendations
- **Static content**: 5-15 minutes
- **Temperature sensors**: 2-5 minutes
- **Interactive use**: 30 seconds to 2 minutes

## Troubleshooting

### Dashboard Not Loading
1. Check that all entity IDs exist in your Home Assistant
2. Verify the theme is properly installed
3. Check the browser console for errors

### Poor Display Quality
1. Ensure you're using the eink theme
2. Verify custom CSS is loaded
3. Check your eink device's refresh settings

### Entity Errors
1. Replace placeholder entity IDs with your actual device IDs
2. Check that all referenced devices are properly configured
3. Verify group and script configurations

### Performance Issues
1. Reduce refresh rate on your eink device
2. Remove unused entities from the dashboard
3. Simplify complex automations

## Advanced Configuration

### Custom Automations
You can extend the AC control automation to include:
- Humidity-based control
- Time-based schedules
- Occupancy detection

### Additional Sensors
Consider adding:
- Energy usage displays
- Weather information
- Security system status

### Integration with Other Systems
The dashboard can be extended to work with:
- Voice assistants
- Mobile notifications
- Smart home hubs

## Support

For issues or questions:
1. Check the Home Assistant logs for errors
2. Verify all entity IDs match your devices
3. Test individual components before adding to the dashboard
4. Consider starting with a minimal configuration and expanding gradually
