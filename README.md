# Falcon Gunnery Card

A full-screen Star Wars "nav console" for Home Assistant, with a live flight radar in the middle. It's built to match the [Falcon Gunnery Theme](https://github.com/marknoordam/Falcon-Gunnery-Theme).

- **Left panel:** outdoor temperature, your light switches, thermostat and humidity ring gauges, a power level meter (the busiest circuit in red), and energy used today.
- **Center:** a flight radar for the [FlightRadar24 integration](https://github.com/AlexandrErohin/home-assistant-flightradar24), drawn as a gunnery radar:
  - a black scope with a faint grid, stars, crosshair, X lines, an ellipse and range rings
  - your local map as faint teal lines (roads, rivers, shorelines)
  - a sweep beam, and blips that light up as it passes
- **Right panel (security):** weather, a tappable list of locks, alarm and doors, and any cards you add, such as your camera views. Tap **Aircraft** to swap it for the flight list.

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
  lights:
    - light.living_room
    - light.kitchen
    - { entity: light.garage, name: Hangar bay }
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
    - lock.front_door
    - alarm_control_panel.home
    - cover.garage_door
  cards:                     # any Home Assistant cards, shown under the list
    - type: picture-entity
      entity: camera.front_door
      show_state: false
```

To use a camera card you already have, open it in the dashboard editor → **Show code editor**, copy its YAML, and paste it as an item under `cards:` (indent it to line up).

Leave out anything you don't have, and that part of the panel disappears.

### 4. Daily count of nearby planes (optional)

The console can show how many different planes came within 10 km of your home today, resetting at midnight. The counting runs in Home Assistant, so it keeps counting while no dashboard is open and every screen shows the same number.

1. Copy [`examples/planes-today.yaml`](examples/planes-today.yaml) into Home Assistant. The file explains two ways: as a package file (recommended), or pasted into `configuration.yaml`.
2. **Developer tools → YAML → Check configuration**, then restart Home Assistant.
3. Add the new sensor to the card:
   ```yaml
   radar:
     today_count: sensor.planes_within_10_km_today
   ```

The radar then shows an amber **TODAY** counter under the aircraft count (add `today_ring: true` for a dashed ring marking the zone). The Aircraft row reads, for example, "6 now · 42 today". To use a different distance, change `radius_km` in both places in the YAML file, and set `today_radius_km` on the card to match.

## Updating

When a new version is published, it shows up in **Settings → Updates**. Click **Update**, then refresh the browser.

## Using the console

| To | Do this |
|---|---|
| Show the flight list | Tap **Aircraft** (first row on the right), or the plane tab on the right panel's edge |
| Go back to home status | Tap **Home status** at the top of the flight list, or the shield tab |
| Track a plane | Tap its blip on the radar, or its row in the flight list. An amber circle locks on, and the readout under the radar shows the aircraft model, where to look in the sky (compass direction and how high up), its route by city and airport code, and its heading, altitude and speed |
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
| `aurebesh_size` | `1.3` | Size of the Aurebesh labels. `1` is the original size |
| `scale` | `1.25` | Size of text, gauges, readouts and plane markers. `1` is the original size; the side panels widen to match. Camera and other embedded cards keep their own size |
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
| `trail_width` | `2.2` | Thickness of the trails (the original was `1.2`) |
| `smooth_motion` | `true` | Move planes between sensor updates |
| `linger_time` | `45` | Seconds a lost contact stays (dimmed) before removal |
| `low_altitude` | `10000` | Planes below this many feet are amber |
| `alert_distance` | `0` | Pulse planes closer than this (in `distance_unit`); 0 = off |
| `sound_alerts` | `none` | `none`, `new_contact`, `proximity`, `emergency`, `highlight` (special aircraft) or `all`. When on, a speaker button appears on the scope; tap it once to allow sound |
| `stale_after` | `120` | Seconds without an update, while planes are showing, before a red STALE warning appears (0 = off) |
| `speed_unit` | `kts` | `kts` or `kmh` |
| `altitude_unit` | `ft` | `ft` or `m` |
| `show_details` | `true` | Airline, model, registration and route in the flight list |
| `show_photo` | `true` | Photo of the selected aircraft at the top of the flight list |
| `highlights` | `[warplane, rcaf]` | Special aircraft to flag with their own color and icon (see below). `[]` turns flagging off |
| `today_count` | none | The daily count sensor from [`examples/planes-today.yaml`](examples/planes-today.yaml). Shows the TODAY counter and the zone ring |
| `today_radius_km` | `10` | Counting distance shown on the TODAY counter, in km. Match the sensor's `radius_km` |
| `today_ring` | `false` | `true` draws a dashed amber ring at the counting distance |

### `left:`
| Option | What it shows |
|---|---|
| `width` | Panel width, in pixels (default `190` × `scale`) |
| `outside_temp` | Temperature sensor in the top readout |
| `lights` | Light switches, shown above the thermostat: plain entity names, or `{ entity, name, tap_action }`. Tap to toggle |
| `lights_name` | Heading over the lights (default `Lights`) |
| `thermostat` | Climate device in the ring gauge |
| `meter` | List of power sensors: plain entity names, or `{ name, entity }` |
| `meter_title`, `meter_max` | Meter heading, and full-scale value (default: automatic) |
| `humidity` | Humidity sensor in the green ring |
| `energy_today` | Energy sensor in the bottom readout |
| `*_name` | Rename any label, for example `thermostat_name: Upstairs` |
| `sump_pump` | Sump pump box at the bottom (see below) |
| `washer` | Washer box at the bottom (see below) |

### `right:`
| Option | What it shows |
|---|---|
| `width` | Panel width, in pixels (default `250` × `scale`). Widen it for bigger camera views |
| `weather` | Weather device: condition, temperature, and today's high and low |
| `status` | List of devices: plain entity names, or `{ entity, name, tap_action }` where `tap_action` is `toggle` or `more-info` |
| `cards` | A list of any Home Assistant cards (camera cards, picture-glance, your own custom cards) shown under the list. They shrink evenly, keeping their shape, so they all fit below the security list. They hide while the flight list is open |
| `cards_min_share` | The smallest share of the panel the cards keep when the list is long, 0.2 to 0.85 (default `0.35`). Raise it for bigger cameras; the list then scrolls |
| `view` | Which side shows first: `status` or `contacts` |

### Special aircraft

Two groups are flagged out of the box, each with its own color and icon:

| Preset | Shows as | Recognized by |
|---|---|---|
| `warplane` | Gold star, tag **CWH** | The Canadian Warplane Heritage Museum's ICAO code **CWH** ("WARPLANE HERITAGE"), and its aircraft registrations (C-GVRA Lancaster, C-GCWM Mitchell, C-GCWH Hurricane, CF-UUU Harvard, CF-DLC Fleet 21) |
| `rcaf` | RCAF roundel, tag **RCAF** | The Canadian Forces ICAO code **CFC** ("CANFORCE"), an operator name like Royal Canadian Air Force, or a numbers-only military serial on a Canadian transponder |

Flagged planes:
- show a heading tick next to their icon
- sort to the top of the flight list, after emergencies
- show their group name in the tracking readout
- can trigger a sonar ping (`sound_alerts: highlight` or `all`)

Emergencies still turn them red.

Add your own groups, or change a preset:

```yaml
radar:
  highlights:
    - warplane
    - rcaf
    - preset: warplane                 # extend a preset: add a registration you've spotted
      registration: [C-GVRA, C-FBXL]
    - name: Snowbirds
      label: SNB
      color: '#ff5fa2'
      icon: diamond                    # arrow, star, roundel or diamond
      callsign_prefix: [SNB]
```

Rules can match on `callsign_prefix`, `callsign`, `airline` (part of the operator name), `registration`, `aircraft_code` or `icao24_prefix`. A plane is flagged if it matches any of them. Registrations ignore dashes, so `CF-UUU` also matches `C-FUUU`.

### Sump pump and washer

Two boxes at the bottom of the left panel. [`examples/sump-washer.yaml`](examples/sump-washer.yaml) sets up the Home Assistant helpers: it turns smart-plug power readings into running sensors, and counts the sump pump's runs and run time today.

```yaml
left:
  sump_pump:
    entity: binary_sensor.sump_pump_running        # on/off sensor, or a power sensor in watts
    runs_today: sensor.sump_pump_runs_today        # optional (history stats, count)
    runtime_today: sensor.sump_pump_run_time_today # optional (history stats, time)
    alert_runs: 30        # optional: red when it has run this many times today
    alert_minutes: 5      # optional: red "CHECK" when one run lasts this long
  washer:
    entity: binary_sensor.washer_running   # on/off sensor, a power sensor, or the washer's own status sensor
    remaining: sensor.washer_completion_time   # optional: end time, or minutes left
    stage: sensor.washer_job_state             # optional: wash / rinse / spin
    done_minutes: 60      # how long to show DONE after a cycle ends (0 = only RUNNING / IDLE)
```

| Option | What it does |
|---|---|
| `entity` | What tells the card it's running: an on/off or running sensor, a smart washer's status (`wash`, `rinse`, `spin`, `done` and similar), or a power sensor |
| `power_threshold` | With a power sensor: watts above which it counts as running (default `10`) |
| `name` | Box heading (default `Sump pump` / `Washer`) |

**What the boxes show:**
- **Sump pump:**
  - **IDLE:** runs today, run time today, and when it last ran.
  - **RUNNING:** how long the current run has lasted.
  - **Red CHECK:** a single run passes `alert_minutes`, which can mean a stuck float or a failing pump.
  - **Red box:** runs today reach `alert_runs`.
- **Washer:**
  - **RUNNING:** the cycle stage and time left (or when it started).
  - **DONE, in green:** for an hour after it finishes, so you know to move the laundry.
  - **IDLE:** when it was last used.

Tap a box for the device's details.

## Tips

- **The sweep is animated even if you prefer a still screen.** Set `sweep: false` under `radar:` to stop it.
- **Wall tablets:** the card stops drawing while the screen is off or the tab is hidden.
- **Trying changes without Home Assistant:** serve this folder (`python -m http.server` in the repo root) and open `http://localhost:8000/test/` to run the card with simulated planes and devices.

## Credits

- The radar's behavior is modeled on [flightradar-radar-card](https://github.com/Ehrenholm/flightradar-radar-card) by Fredrik Ehrenholm (MIT): smooth motion, sweep-timed blips, lingering contacts, and helicopter and emergency handling.
- Fonts: Michroma, News Cycle and Share Tech Mono (SIL Open Font License), and Aurebesh Rodian by [AurekFonts](https://github.com/AurekFonts) (MIT). License texts are in [`licenses/`](licenses).
- Map tiles: Esri World Dark Gray Canvas.

Star Wars and related names are trademarks of Lucasfilm Ltd. This is a fan project, not affiliated with or endorsed by Lucasfilm.
