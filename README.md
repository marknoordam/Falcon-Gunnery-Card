# Falcon Gunnery Card

A full-screen Star Wars "nav console" for Home Assistant, with a live flight radar in the middle. It's built to match the [Falcon Gunnery Theme](https://github.com/marknoordam/Falcon-Gunnery-Theme).

- **Left panel:** outdoor temperature, thermostat and humidity ring gauges, a power level meter (the busiest circuit in red), and energy used today.
- **Center:** a flight radar for the [FlightRadar24 integration](https://github.com/AlexandrErohin/home-assistant-flightradar24), drawn as a gunnery radar:
  - a black scope with a faint grid, stars, crosshair, X lines, an ellipse and range rings
  - your local map as faint teal lines (roads, rivers, shorelines)
  - a sweep beam, and blips that light up as it passes
- **Right panel:** weather and a tappable status list. Tap **Aircraft** to swap it for the flight list.

This card also supplies the theme's fonts (Michroma, News Cycle, Share Tech Mono, Aurebesh Rodian) and background images, so install it even if you only want the theme.

## Install

### 1. FlightRadar24 integration (needs [HACS](https://hacs.xyz))

1. In HACS, search for **Flightradar24** (by AlexandrErohin) → **Download** → restart Home Assistant.
2. **Settings → Devices & services → Add integration → Flightradar24**. Note the **radius** you set: the card's `radius` must match it.
3. Keep **minimum altitude at 0** to see helicopters.
4. The sensor the card reads is `sensor.flightradar24_current_in_area`.

### 2. This card

1. In HACS, open **⋮ (top right) → Custom repositories**.
2. Add `https://github.com/marknoordam/Falcon-Gunnery-Card` with type **Dashboard**.
3. Search for **Falcon Gunnery Card** → **Download**.
4. Refresh the browser when HACS asks. HACS adds the dashboard resource for you.

### 3. A full-screen console view

1. Open a dashboard → ✏ edit → add a view, or edit one.
2. Set **View type** to **Panel (single card)**.
3. Add a card → **Manual** → paste this, using your own entity names:

```yaml
type: custom:nav-console-card
radar:
  entity: sensor.flightradar24_current_in_area
  radius: 20                 # same as the FR24 integration radius
  distance_unit: mi
left:
  outside_temp: sensor.outdoor_temperature
  thermostat: climate.living_room
  humidity: sensor.living_room_humidity
  energy_today: sensor.energy_today
  meter_title: Power
  meter:
    - { name: HVAC, entity: sensor.hvac_power }
    - { name: Kitchen, entity: sensor.kitchen_power }
    - { name: Office, entity: sensor.office_power }
right:
  weather: weather.home
  status:
    - light.living_room
    - light.kitchen
    - { entity: light.garage, name: Hangar bay }
    - lock.front_door
    - alarm_control_panel.home
    - cover.garage_door
```

Leave out anything you don't have, and that part of the panel disappears.

## Updating

When a new version is published, it shows up in **Settings → Updates**. Click **Update**, then refresh the browser.

## Using the console

| To | Do this |
|---|---|
| Show the flight list | Tap **Aircraft** (first row on the right), or the plane tab on the right panel's edge |
| Go back to home status | Tap **Home status** at the top of the flight list, or the shield tab |
| Track a plane | Tap its blip on the radar, or its row in the flight list. An amber circle locks on and the readout under the radar shows its details |
| Turn the map lines on or off | Tap the map tab on the left panel's edge |
| Toggle a light | Tap its row. Locks, the alarm and the garage door open their detail popup instead, so one tap can't unlock anything |

**Radar colors:**
- **Teal:** normal traffic
- **Amber:** planes below 10,000 ft
- **Red, pulsing:** emergency squawk codes (7700, 7600, 7500), listed first
- **Circle instead of a triangle:** helicopter
- **Private aircraft:** labeled by aircraft type
- **Dimmed contact:** a plane that dropped out of the data. It coasts for a while before disappearing.

**Status colors:**
- **Teal:** on or secured
- **Red:** unlocked, open, triggered or a problem
- **Amber:** in motion or unavailable
- **Gray:** off or disarmed

## Options

### General
| Option | Default | What it does |
|---|---|---|
| `aurebesh` | `true` | Aurebesh labels throughout |
| `motion` | `false` | Decorative animation (the weather globe spins). The radar sweep is set separately |
| `height` | `fill` | `fill` sizes the console to the screen, or give a number of pixels |
| `height_offset` | `72` | Pixels left for the HA header with `fill`. Use about `16` in kiosk mode |

### `radar:`
| Option | Default | What it does |
|---|---|---|
| `entity` | (required) | `sensor.flightradar24_current_in_area` |
| `radius` | `20` | Scope range. Match your FR24 radius |
| `distance_unit` | `mi` | `mi` or `km` |
| `latitude` / `longitude` | HA home | Scope center |
| `map` | `true` | Faint map lines under the scope |
| `map_opacity` | `0.35` | How bright the map lines are, 0 to 1 |
| `tile_url` | Esri dark gray canvas | Your own map tile template. The provider must allow cross-site image use (CORS) |
| `stars` | `true` | Faint stars behind the scope |
| `sweep` | `true` | Rotating sweep beam. Set `false` for a still scope that refreshes twice a second |
| `sweep_period` | `4` | Seconds per revolution |
| `trail_length` | `7` | Past positions kept per plane (0 = no trails) |
| `trail_style` | `line` | `line` or `dots` |
| `smooth_motion` | `true` | Move planes between sensor updates |
| `linger_time` | `45` | Seconds a lost contact stays (dimmed) before removal |
| `low_altitude` | `10000` | Planes below this many feet are amber |
| `alert_distance` | `0` | Pulse planes closer than this (in `distance_unit`); 0 = off |
| `sound_alerts` | `none` | `none`, `new_contact`, `proximity`, `emergency` or `all`. When on, a speaker button appears on the scope; tap it once to allow sound |
| `stale_after` | `120` | Seconds without an update, while planes are showing, before a red STALE warning appears (0 = off) |
| `speed_unit` | `kts` | `kts` or `kmh` |
| `altitude_unit` | `ft` | `ft` or `m` |
| `show_details` | `true` | Airline, model, registration and route in the flight list |
| `show_photo` | `true` | Photo of the selected aircraft at the top of the flight list |

### `left:`
| Option | What it shows |
|---|---|
| `outside_temp` | Temperature sensor in the top readout |
| `thermostat` | Climate device in the ring gauge |
| `meter` | List of power sensors: plain entity names, or `{ name, entity }` |
| `meter_title`, `meter_max` | Meter heading, and full-scale value (default: automatic) |
| `humidity` | Humidity sensor in the green ring |
| `energy_today` | Energy sensor in the bottom readout |
| `*_name` | Rename any label, for example `thermostat_name: Upstairs` |

### `right:`
| Option | What it shows |
|---|---|
| `weather` | Weather device: condition, temperature, and today's high and low |
| `status` | List of devices: plain entity names, or `{ entity, name, tap_action }` where `tap_action` is `toggle` or `more-info` |
| `view` | Which side shows first: `status` or `contacts` |

## Tips

- **The sweep is animated even if you prefer a still screen.** Set `sweep: false` under `radar:` to stop it.
- **Wall tablets:** the card stops drawing while the screen is off or the tab is hidden.
- **Trying changes without Home Assistant:** serve this folder (`python -m http.server` in the repo root) and open `http://localhost:8000/test/` to run the card with simulated planes and devices.

## Credits

- The radar's behavior is modeled on [flightradar-radar-card](https://github.com/Ehrenholm/flightradar-radar-card) by Fredrik Ehrenholm (MIT): smooth motion, sweep-timed blips, lingering contacts, and helicopter and emergency handling.
- Fonts: Michroma, News Cycle and Share Tech Mono (SIL Open Font License), and Aurebesh Rodian by [AurekFonts](https://github.com/AurekFonts) (MIT). License texts are in [`licenses/`](licenses).
- Map tiles: Esri World Dark Gray Canvas.

Star Wars and related names are trademarks of Lucasfilm Ltd. This is a fan project, not affiliated with or endorsed by Lucasfilm.
