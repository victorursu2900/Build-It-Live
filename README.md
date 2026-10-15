# Tangible Blocks / Build It Live
Welcome to the 3D Voxel Interface project! This repository contains the complete firmware and web application source code for building an interactive, physical-to-digital voxel construction system.

---

## 📌 Project Overview & How to Use This Guide

This project links 3D-printed voxel blocks with an interactive web dashboard using an ESP32-C6 microcontroller, an ADS1115 ADC, and a CD74HC4067 multiplexer.

> **Important Workflow Note:**  
> This repository serves to **host the source code and deploy the platform**.  
> The **Web Application** contains the comprehensive, step-by-step interactive manual, including:
> 1. Complete Bill of Materials (BOM) with direct component links.
> 2. The built-in **Brick Maker** to generate and export block STL models.
> 3. Precise 3D printing guides (layer pauses and hardware embedding).
> 4. Physical wiring schematics for 4×4 up to 16×16 grids.
> 5. Real-time Web Serial calibration and 3D voxel space visualization.

---

## 🚀 Quickstart: Installation & Setup

### Repository Structure
```text
├── firmware/         # C++ / PlatformIO firmware for the ESP32-C6
├── webapp/           # Frontend web application & 3D voxel engine
└── README.md

```

---

### 1. Launching the Web Application

The web application hosts the user manual, 3D visualization canvas, and the **Brick Maker** tool.

#### Prerequisites

* Node.js (v18+ recommended)
* npm or yarn

#### Steps

1. Clone the repository:
```bash
git clone https://github.com/victorursu2900/Build-It-Live.git
cd Build-It-Live/webapp

```


2. Install dependencies:
```bash
npm install

```


3. Start the local development server:
```bash
npm run dev

```


4. Open the displayed URL (typically `http://localhost:5173` or `http://localhost:3000`) in **Google Chrome** or **Microsoft Edge** (required for Web Serial API support).
5. **Follow the on-screen instructions inside the app** to begin fabrication and calibration.

---

### 2. Flashing the Firmware (ESP32-C6)

The firmware scans the physical baseplate channels, measures resistance values via the ADS1115 ADC, and streams raw data to the web app.

#### Prerequisites

* [VS Code](https://code.visualstudio.com/) with the [PlatformIO IDE extension](https://platformio.org/) installed (recommended), or Arduino IDE.

#### Steps

1. Open the project:

* In VS Code, navigate to `File` > `Open Folder...` and select the `firmware/` directory.

2. Verify dependencies:

* The required libraries (e.g., `Adafruit ADS1X15`) will install automatically via `platformio.ini`.

3. Connect your board:

* Connect the **ESP32-C6** to your computer via USB-C.

4. Build and upload:

* Click the PlatformIO **Upload** button (arrow icon on the bottom status bar) or run:

```bash
pio run --target upload

```

5. Confirm serial communication:

* Close the PlatformIO Serial Monitor before opening the web app to ensure the Web Serial port remains free.

#### Troubleshooting

* **Upload Stuck (Connecting...):** If the terminal hangs on `Connecting........_____.....`, the board failed to enter bootloader mode automatically. Press and hold the physical **BOOT** button on the ESP32-C6 until the flashing percentage begins.
* **Access Denied Error:** PlatformIO cannot flash the board if the COM port is locked. Ensure the board is disconnected from the web app and all Serial Monitors are closed before clicking Upload.
* **Port Not Found:** If the ESP32-C6 does not appear as a selectable COM port, your computer is missing the USB-to-UART bridge driver. Download and install the driver specific to your dev board's serial chip (typically CH343 or CP210X).



---

## 📖 Next Steps

Head over to your running **Web Application** at `http://localhost:5173` to view the comprehensive assembly guide, purchase list, and Brick Maker!



