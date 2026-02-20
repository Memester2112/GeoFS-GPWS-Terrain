const FEET_TO_METERS_X = 0.3048;

// 1. CLEANUP: Remove old UI and Timers
if (window.gpwsInterval) clearInterval(window.gpwsInterval);
let oldUI = document.getElementById("gpws-alert-box");
if (oldUI) oldUI.remove();

// 2. VISUAL UI SETUP: Injecting the HTML/CSS
const alertBox = document.createElement("div");
alertBox.id = "gpws-alert-box";
alertBox.innerHTML = "PULL UP";
// Styling: Big, Red, Flashing, Centered
alertBox.style.cssText = `
    position: absolute; 
    top: 25%; 
    left: 50%; 
    transform: translate(-50%, -50%); 
    background-color: rgba(255, 0, 0, 0.9); 
    color: yellow; 
    font-family: Arial, sans-serif; 
    font-size: 60px; 
    font-weight: 900; 
    padding: 20px 40px; 
    border: 5px solid yellow; 
    display: none; 
    z-index: 99999; 
    box-shadow: 0 0 20px red;
    pointer-events: none;
`;
document.body.appendChild(alertBox);

// Blinking Animation logic
let blinkState = false;

// 3. AUDIO SETUP
const sndPullUp = new Audio(
  "https://cdn.jsdelivr.net/gh/avramovic/geofs-alerts@master/audio/terrain-terrain-pull-up.mp3",
);
sndPullUp.volume = 1.0;
let lastPlayTime = 0;

// 4. MATH
function getFutureLookahead(secondsAhead) {
  let plane = geofs.aircraft.instance;
  if (!plane || !plane.llaLocation || !plane.velocity) return null;

  let currentLat = plane.llaLocation[0];
  let currentLon = plane.llaLocation[1];
  let distEast = plane.velocity[0] * secondsAhead;
  let distNorth = plane.velocity[1] * secondsAhead;
  let metersPerDegree = 111320;
  let deltaLat = distNorth / metersPerDegree;
  let deltaLon =
    distEast / (metersPerDegree * Math.cos(currentLat * (Math.PI / 180)));
  // change in Logitude depends on current latitude, because the Earth is a sphere. At the equator, 1 degree of longitude is about 111.32 km, but as you move towards the poles, the distance represented by 1 degree of longitude decreases.
  //  The formula accounts for this by multiplying the meters per degree by the cosine of the current latitude (converted to radians).
  // This way, we get an accurate change in longitude based on our current position on the globe.

  return [currentLat + deltaLat, currentLon + deltaLon];
}

// 5. MAIN LOGIC
function runGPWS() {
  let plane = geofs.aircraft.instance;
  if (!plane || !plane.llaLocation) return;

  let gearDown = false;
  if (plane.animationValue && plane.animationValue.gearPosition !== undefined) {
    gearDown = plane.animationValue.gearPosition < 0.5;
  }

  let currentAltMSL = plane.llaLocation[2];
  let currentGroundAlt =
    geofs.animation.values.groundElevationFeet * FEET_TO_METERS_X || 0;
  let currentAGL = currentAltMSL - currentGroundAlt;
  let vz = plane.velocity[2];

  // === SAFETY FILTERS ===
  // 1. Radar Altimeter Ceiling: GPWS inactive above 2,500 ft (762m)
  if (currentAGL > 762) {
    // console.log("Above 2500 ft MSL. GPWS inactive.");
    resetAlert();
    return;
  }

  if (plane.groundContact) {
    // console.log("Plane is on the ground. GPWS inactive.");
    resetAlert();
    return;
  }

  if (currentAGL < 50 && gearDown && vz > 0) {
    // console.log("Below 50m AGL with gear down and climbing. Muting GPWS to prevent false alarms during landing flare.");
    resetAlert();
    return;
  }

  // 2. Landing Mute :
  // If gear is down and we are very close to ground (< 500m / 1600ft), plane is descending and spd < 200 knots (103 m/s),
  // we can assume we are landing and mute GPWS to prevent false alarms during approach and flare.
  // descent spd should be less than 2000 fpm or 10 m/s, else GPWS does not mute because we are sinking too fast for landing.
  if (
    gearDown &&
    currentAGL < 500 &&
    vz < 0 &&
    vz > -10 &&
    plane.groundSpeed < 103
  ) {
    // console.log("Gear down and below 500m AGL. Muting GPWS for landing.");
    resetAlert();
    return;
  }

  // === TERRAIN SCAN ===
  let secondsAhead = 15;
  let futureE = getFutureLookahead(secondsAhead);

  // Default to safe if math fails
  if (!futureE) {
    // console.warn("Future position calculation failed. Skipping GPWS check.");
    resetAlert();
    return;
  }

  let futureGroundAlt = geofs.api.getGroundAltitude(futureE);
  // If terrain isn't loaded, don't guess.
  if (futureGroundAlt === undefined || isNaN(futureGroundAlt)) {
    console.warn("Future terrain data unavailable. Skipping GPWS check.");
    resetAlert();
    return;
  }

  // FLTA: Calculate Clearance
  let projectedAltMSL = currentAltMSL + vz * secondsAhead;
  let projectedClearance = projectedAltMSL - futureGroundAlt;

  let triggerWarning = false;
  //   console.log(
  //     `Current AGL: ${Math.round(currentAGL)}m, Projected Clearance in 15s: ${Math.round(projectedClearance)}m, Vertical Speed: ${Math.round(vz)} m/s`,
  //   );
  // === THREAT EVALUATION ===
  // Trigger if projected clearance is dangerously low (< 100m)
  // OR if we are sinking fast (-5 m/s) with moderate clearance (< 200m)
  if (projectedClearance < 100 || (projectedClearance < 200 && vz < -5)) {
    triggerWarning = true;
  }

  // === OUTPUT ===
  if (triggerWarning) {
    // console.log(
    //   `Projected Clearance: ${Math.round(projectedClearance)}m, Vertical Speed: ${Math.round(vz)} m/s`,
    // );
    // AUDIO
    let now = Date.now();
    if (now - lastPlayTime > 4500) {
      sndPullUp.currentTime = 0;
      sndPullUp.play().catch((e) => console.log("Click screen for audio"));
      lastPlayTime = now;
      //   console.warn(`PULL UP! Clearance: ${Math.round(projectedClearance)}m`);
    }

    // VISUAL (Blinking Effect)
    blinkState = !blinkState;
    alertBox.style.display = blinkState ? "block" : "none";
  } else {
    resetAlert();
  }
}

function resetAlert() {
  alertBox.style.display = "none";
  blinkState = false;
}

// 6. IGNITION
// Running at 250ms (4 times a second) for smoother blinking animation
window.gpwsInterval = setInterval(runGPWS, 250);
// console.log("Visual EGPWS Activated. Gear logic updated to MUTE below 50m.");
