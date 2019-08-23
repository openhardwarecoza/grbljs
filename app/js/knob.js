Number.prototype.map = function(in_min, in_max, out_min, out_max) {
  return (this - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

const knobfeed = document.getElementById('knobfeed');
const currfeed = document.getElementById('currentfeed');
const resetfeed = document.getElementById('reset-feed');
const ticksfeed = Array.from(document.getElementsByClassName('ticksfeed'));
const minfeed = 50;
const maxfeed = 200;
let anglefeed = 100;
var feedrateOverrideEvent;

const knobspeed = document.getElementById('knobspeed');
const currspeed = document.getElementById('currentspeed');
const resetspeed = document.getElementById('reset-speed');
const ticksspeed = Array.from(document.getElementsByClassName('ticksspeed'));
const minspeed = 50;
const maxspeed = 200;
let anglespeed = 100;
var speedOverrideEvent;

const knobrapid = document.getElementById('knobrapid');
const currrapid = document.getElementById('currentrapid');
const resetrapid = document.getElementById('reset-rapid');
const ticksrapid = Array.from(document.getElementsByClassName('ticksrapid'));
const minrapid = 25;
const maxrapid = 100;
let anglerapid = 100;
var rapidOverrideEvent;

$(document).ready(function() {
  setAngleFeed()
  setAngleSpeed()
  setAngleRapid()
})

const transform = (() => {
  for (let prop of ['transform', 'msTransform', 'webkitTransform', 'mozTransform', 'oTransform']) {
    if (typeof document.body.style[prop] != 'undefined') {
      return prop;
    }
  }
})();

function turntUpFeed(bool) {
  anglefeed = (bool && anglefeed + 5 <= maxfeed) ?
    anglefeed + 5 : (!bool && anglefeed - 5 >= minfeed) ?
    anglefeed - 5 : anglefeed;
  return setAngleFeed();
}

function turntUpSpeed(bool) {
  anglespeed = (bool && anglespeed + 5 <= maxspeed) ?
    anglespeed + 5 : (!bool && anglefeed - 5 >= minspeed) ?
    anglespeed - 5 : anglespeed;
  return setAngleSpeed();
}

function turntUpRapid(bool) {
  if (bool) {
    if (anglerapid == 25) {
      anglerapid = 50
    } else if (anglerapid == 50) {
      anglerapid = 100
    }
  } else if (!bool) {
    if (anglerapid == 100) {
      anglerapid = 50
    } else if (anglerapid == 50) {
      anglerapid = 25
    }
  }

  // anglerapid = (bool && anglerapid + 5 <= maxrapid) ?
  //   anglerapid + 5 : (!bool && anglerapid - 5 >= minrapid) ?
  //   anglerapid - 5 : anglerapid;
  return setAngleRapid();
}

function setAngleFeed() {
  clearTimeout(feedrateOverrideEvent);
  // rotate knob
  knobfeed.style[transform] = `rotate(${(anglefeed-60)*2}deg)`;
  // quickly reset ticks
  for (let tick of ticksfeed) {
    tick.classList.remove('active');
  }
  // add glow to 'active' ticks
  const actives = (Math.round((anglefeed - 50) / 5) + 1);
  for (let tick of ticksfeed.slice(0, actives)) {
    tick.classList.add('active');
  }
  console.log(anglefeed); // 0
  feedrateOverrideEvent = setTimeout(function() {
    currfeed.innerHTML = `${anglefeed}%`;
    socket.emit('feedOverride', anglefeed)
    printLog("[override] Setting Feed Override to " + anglefeed + "%");
  }, 200);
}

function setAngleSpeed() {
  clearTimeout(speedOverrideEvent);
  // rotate knob
  knobspeed.style[transform] = `rotate(${(anglespeed-60)*2}deg)`;
  // quickly reset ticks
  for (let tick of ticksspeed) {
    tick.classList.remove('active');
  }
  // add glow to 'active' ticks
  const actives = (Math.round((anglespeed - 50) / 5) + 1);
  for (let tick of ticksspeed.slice(0, actives)) {
    tick.classList.add('active');
  }
  console.log(anglespeed); // 0
  speedOverrideEvent = setTimeout(function() {
    currspeed.innerHTML = `${anglespeed}%`;
    socket.emit('spindleOverride', anglespeed)
    printLog("[override] Setting Speed Override to " + anglespeed + "%");
  }, 200);
}

function setAngleRapid() {
  clearTimeout(rapidOverrideEvent);
  // rotate knob
  knobrapid.style[transform] = `rotate(${(anglerapid-30)*2}deg)`;
  // quickly reset ticks
  for (let tick of ticksrapid) {
    tick.classList.remove('active');
  }
  // add glow to 'active' ticks
  const actives = (Math.round((anglerapid - 25) / 5) + 1);
  for (let tick of ticksrapid.slice(0, actives)) {
    tick.classList.add('active');
  }
  console.log(anglerapid); // 0
  rapidOverrideEvent = setTimeout(function() {
    currrapid.innerHTML = `${anglerapid}%`;
    socket.emit('rapidOverride', anglerapid)
    printLog("[override] Setting Rapid Override to " + anglerapid + "%");
  }, 200);
}

const handlerfeed = e => turntUpFeed(e.wheelDelta > 0);
knobfeed.addEventListener('mousewheel', handlerfeed);
knobfeed.addEventListener('DOMMouseScroll', handlerfeed);
resetfeed.addEventListener("click", function() {
  anglefeed = 100;
  setAngleFeed();
});

const handlerspeed = e => turntUpSpeed(e.wheelDelta > 0);
knobspeed.addEventListener('mousewheel', handlerspeed);
knobspeed.addEventListener('DOMMouseScroll', handlerspeed);
resetspeed.addEventListener("click", function() {
  anglespeed = 100;
  setAngleSpeed();
});

const handlerrapid = e => turntUpRapid(e.wheelDelta > 0);
knobrapid.addEventListener('mousewheel', handlerrapid);
knobrapid.addEventListener('DOMMouseScroll', handlerrapid);
resetrapid.addEventListener("click", function() {
  anglerapid = 100;
  setAngleRapid();
});