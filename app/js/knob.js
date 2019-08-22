Number.prototype.map = function(in_min, in_max, out_min, out_max) {
  return (this - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

const knob = document.getElementById('knob');
const curr = document.getElementById('current');
const ticks = Array.from(document.getElementsByClassName('tick'));

const min = 50;
const max = 200;
let angle = 100;
$(document).ready(function() {
  setAngle()
})
const transform = (() => {
  for (let prop of ['transform', 'msTransform', 'webkitTransform', 'mozTransform', 'oTransform']) {
    if (typeof document.body.style[prop] != 'undefined') {
      return prop;
    }
  }
})();

function turntUp(bool) {
  angle = (bool && angle + 5 <= max) ?
    angle + 5 : (!bool && angle - 5 >= min) ?
    angle - 5 : angle;

  return setAngle();
}

function setAngle() {
  // rotate knob
  knob.style[transform] = `rotate(${(angle-60)*2}deg)`;

  // quickly reset ticks
  for (let tick of ticks) {
    tick.classList.remove('active');
  }

  // add glow to 'active' ticks
  const actives = (Math.round((angle - 50) / 5) + 1);
  for (let tick of ticks.slice(0, actives)) {
    tick.classList.add('active');
  }

  // update % value as text

  curr.innerHTML = `${angle}%`;

  console.log(angle); // 0


}

const handler = e => turntUp(e.wheelDelta > 0);
knob.addEventListener('mousewheel', handler);
knob.addEventListener('DOMMouseScroll', handler);