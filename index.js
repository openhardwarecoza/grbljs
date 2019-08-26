console.log("API:");
console.log("implemented: ")
console.log("socket.emit('connectTo', {port: 'string', baud: 115200})");
console.log("socket.emit('closePort', true)");
console.log("socket.emit('runJob', gcode)");
console.log("socket.emit('pause', true)");
console.log("socket.emit('resume', true)");
console.log("socket.emit('stop', jog bool)");
console.log("socket.emit('clearAlarm', 1/2)");
console.log("socket.emit('runCommand', data)");
console.log("todo: ")
console.log("socket.emit('zProbe', {dist: 25, plate: 20, feedrate: 100, direction: 'Z-'})");
console.log("socket.emit('jog', {dist: 10, feed: 1000, dir: 'X+'})");
console.log("socket.emit('feedOverride', '50-200')");
console.log("socket.emit('spindleOverride', '50-200')");

// Utilities
var fs = require('fs');
var path = require("path");
const join = require('path').join;
var _ = require('lodash');
const grblStrings = require("./grblStrings.js");

// SerialPort
const serialport = require('serialport');
var SerialPort = serialport;
const Readline = SerialPort.parsers.Readline;
var ip = require("ip");

// telnet
const net = require('net');

// WebServer
var express = require("express");
var app = express();
var http = require("http").Server(app);
var https = require('https');
app.use(express.static(path.join(__dirname, "app")));
app.on('certificate-error', function(event, webContents, url, error,
  certificate, callback) {
  event.preventDefault();
  callback(true);
});
var httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'domain-key.key')),
  cert: fs.readFileSync(path.join(__dirname, 'domain-crt.cer'))
};
const httpsserver = https.createServer(httpsOptions, app).listen(3001, function() {
  console.log('https: listening on:' + ip.address() + ":3001");
});
const httpserver = http.listen(3000, '0.0.0.0', function() {
  console.log('http:  listening on:' + ip.address() + ":3000");
});

// Socket.IO Server
var ioServer = require('socket.io');
var io = new ioServer();
io.attach(httpserver);
io.attach(httpsserver);

// Variables
var oldportslist, oldpinslist = [],
  gcodeQueue = [],
  queuePointer = 0,
  statusLoop, queueCounter, sentBuffer = [];
var GRBL_RX_BUFFER_SIZE = 127; // 128 characters
var xPos = 0.00,
  yPos = 0.00,
  zPos = 0.00,
  aPos = 0.00;
var xOffset = 0.00,
  yOffset = 0.00,
  zOffset = 0.00,
  aOffset = 0.00;
var has4thAxis = false;
var feedOverride = 100,
  spindleOverride = 100,
  rapidOverride = 100;

var status = {
  driver: {
    version: require('./package').version,
    ipaddress: ip.address(),
    operatingsystem: false
  },
  machine: {
    name: '',
    inputs: [],
    accesories: [],
    overrides: {
      feedOverride: 100, //
      spindleOverride: 100, //
      rapidOverride: 100
    },
    values: {
      realFeed: 0, //
      realSpindle: 0 //
    },
    modals: {
      motionmode: "G0", // G0, G1, G2, G3, G38.2, G38.3, G38.4, G38.5, G80
      coordinatesys: "G54", // G54, G55, G56, G57, G58, G59
      plane: "G17", // G17, G18, G19
      distancemode: "G90", // G90, G91
      arcdistmode: "G91.1", // G91.1
      feedratemode: "G94", // G93, G94
      unitsmode: "G21", // G20, G21
      radiuscomp: "G40", // G40
      tlomode: "G49", // G43.1, G49
      programmode: "M0", // M0, M1, M2, M30
      spindlestate: "M5", // M3, M4, M5
      coolantstate: "M9", // M7, M8, M9
      tool: "0",
      spindle: "0",
      feedrate: "0"
    },
    probe: {
      x: 0.00,
      y: 0.00,
      z: 0.00,
      state: -1,
      plate: 0.00,
      request: {}
    },
    status: {
      work: {
        x: 0,
        y: 0,
        z: 0,
        a: 0,
        e: 0
      },
      offset: {
        x: 0,
        y: 0,
        z: 0,
        a: 0,
        e: 0
      }
    },
    firmware: {
      type: "",
      version: "",
      date: "",
      buffer: [],
      features: [],
      blockBufferSize: "",
      rxBufferSize: "",
    },
  },
  comms: {
    connectionStatus: 0, //0 = not connected, 1 = opening, 2 = connected, 3 = playing, 4 = paused
    runStatus: "Pending", // 0 = init, 1 = idle, 2 = alarm, 3 = stop, 4 = run, etc?
    queue: 0,
    blocked: false,
    paused: false,
    interfaces: {
      ports: "",
      activePort: "", // or activeIP in the case of wifi/telnet?
      type: ""
    },
    alarm: ""
  }
};


// Detect OS
function detectOS() {
  if (process.platform == 'win32') {
    return 'win32';
  }
  if (process.platform == 'darwin') {
    return 'macos';
  }
  if (process.platform == 'linux') {
    return 'linux';
  }
  if (process.platform == 'freebsd') {
    return 'freebsd';
  }
  if (process.platform == 'sunos') {
    return 'sunos';
  }
  var isPi = require('detect-rpi');
  if (isPi()) {
    return 'raspberrypi';
  }
}
status.driver.operatingsystem = detectOS();


// Service Loop
var serviceInterval = setInterval(function() {
  // Check Ports
  if (status.comms.connectionStatus == 0) {
    SerialPort.list(function(err, ports) {
      status.comms.interfaces.ports = ports;
      if (!_.isEqual(ports, oldportslist)) {
        var newPorts = _.differenceWith(ports, oldportslist, _.isEqual)
        if (newPorts.length > 0) {
          console.log("Plugged " + newPorts[0].comName);
          postLog("usb", "Plugged " + newPorts[0].comName)
        }
        var removedPorts = _.differenceWith(oldportslist, ports, _.isEqual)
        if (removedPorts.length > 0) {
          console.log("Unplugged " + removedPorts[0].comName);
          postLog("usb", "Unplugged " + removedPorts[0].comName)
        }
      }
      oldportslist = ports;
    });
  }
  // Update UI
  io.sockets.emit("status", status);
}, 500);

// Handlers:
// Handler: IO
io.on("connection", function(socket) {
  socket.on("connectTo", function(data) { // If a user picks a port to connect to, open a Node SerialPort Instance to it
    console.log(data)
    if (status.comms.connectionStatus < 1) {


      if (data.type == "usb") {
        postLog("connect", "Connecting to " + data.port + " at baud " + data.baud + " via " + data.type)
        port = new SerialPort(data.port, {
          baudRate: parseInt(data.baud)
        });
      } else if (data.type == "telnet") {
        postLog("connect", "Connecting to " + data.ip + " via " + data.type)
        port = net.connect(23, data.ip);
        port.isOpen = true;
      }

      parser = port.pipe(new Readline({
        delimiter: '\r\n'
      }));

      port.on("error", function(err) {
        if (err.message != "Port is not open") {
          postLog("", "PORT ERROR: " + err.message)
          if (status.comms.connectionStatus > 0) {
            status.comms.connectionStatus = 0;
            stopPort();
          } else {
            console.log('ERROR: Machine connection not open!');
          }
        }

      });


      port.on("ready", function(e) {
        portOpened(port, data)
      });

      port.on("open", function(e) {
        portOpened(port, data)
        // postLog("connect", "PORT INFO: Port is now open: " + port.path + " - Attempting to detect Firmware")
        // postLog("connect", "Checking for firmware on " + port.path);
        // status.comms.connectionStatus = 1;
        // addQRealtime("\n"); // this causes smoothie to send the welcome string
        // postLog("connect", "Detecting Firmware: Method 1 (Autoreset)")
        // setTimeout(function() { //wait for controller to be ready
        //   if (status.machine.firmware.type.length < 1) {
        //     postLog("connect", "Detecting Firmware: Method 2 (Ctrl+X)")
        //     addQRealtime(String.fromCharCode(0x18)); // ctrl-x (needed for rx/tx connection)
        //   }
        // }, 2000);
        // setTimeout(function() {
        //   // Close port if we don't detect supported firmware after 2s.
        //   if (status.machine.firmware.type.length < 1) {
        //     postLog("connect", "No supported firmware detected. Closing port " + port.path)
        //     stopPort();
        //   } else {
        //     postLog("connect", "Firmware Detected:  " + status.machine.firmware.type + " version " + status.machine.firmware.version + " on " + port.path)
        //   }
        // }, 4000);
        // status.comms.connectionStatus = 2;
        // status.comms.interfaces.activePort = port.path;
        // status.comms.interfaces.activeBaud = port.baudRate;
      }); // end port .onopen

      port.on("close", function() { // open errors will be emitted as an error event
        postLog("disconnect", "PORT INFO: Port closed")
        status.comms.connectionStatus = 0;
      }); // end port.onclose

      parser.on("data", function(data) {

        console.log(data)

        var command = sentBuffer[0];

        // Machine Identification: non Grbl
        if (data.indexOf("LPC176") >= 0) { // LPC1768 or LPC1769 should be Smoothieware
          isSmoothie(data);
        }

        //Grbl Responses as per https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface#message-summary
        if (data.indexOf("ok") === 0) {
          gotOK(data)
        } else if (data.indexOf('error') === 0) {
          gotError(data)
        } else if (data.indexOf("<") === 0) {
          parseFeedback(data)
        } else if (data.indexOf("Grbl") === 0) {
          isGrbl(data);
          command = "firmware startup"
        } else if (data.indexOf('ALARM') === 0) {
          gotAlarm(data)
        } else if (data.indexOf("[MSG:") === 0) {
          gotMessage(data)
        } else if (data.indexOf("[VER:") === 0) {
          parseVersion(data);
          command = "$I"
        } else if (data.indexOf("[OPT:") === 0) {
          parseOpt(data);
          command = "$I"
        } else if (data.indexOf("[PRB:") === 0) {
          parseProbe(data);
        } else if (data.indexOf(">") === 0) {
          command = "startup line"
        } else if (data.indexOf("[echo:") === 0) {
          command = "echo"
        } else if (data.indexOf("[G54:") === 0 || data.indexOf("[G55:") === 0 || data.indexOf("[G56:") === 0 || data.indexOf("[G57:") === 0 || data.indexOf("[G58:") === 0 || data.indexOf("[G59:") === 0 || data.indexOf("[G28:") === 0 || data.indexOf("[G30:") === 0 || data.indexOf("[G92:") === 0 || data.indexOf("[TLO:") === 0) {
          gotCoords(data)
        } else if (data.indexOf("[GC:") === 0) {
          gotModals(data)
        } else if (data.indexOf("$N") === 0) {
          //$Nx=line indicate a settings printout from $N user query
        } else if (data.indexOf("$") === 0) {
          //$x=line indicate a settings printout from $$ user query
        } else if (data.indexOf("[HLP:") === 0) {
          //help message
        } else {
          // unknown data: Just log
          command = "unknown source"
          console.log("unknown data: " + data)
        }

        // Output for Log
        if (command) {
          command = command.replace(/(\r\n|\n|\r)/gm, "");
          if (command != "?" && command != "M105" && data.length > 0 && data.indexOf('<') == -1) {
            postLog(command, data)
          }
        } else {
          if (data.indexOf("<") != 0) {
            postLog("", data)
          }
        }
        // end Log Output
      }); // end port.ondata
    }; // end if connectionStatus > 1
  }); // end socket.onConnectTo

  socket.on('runCommand', function(data) {
    if (status.comms.connectionStatus > 0) {
      if (data) {
        data = data.split('\n');
        for (var i = 0; i < data.length; i++) {
          var line = data[i].split(';'); // Remove everything after ; = comment
          var tosend = line[0].trim();
          if (tosend.length > 0) {
            addQToEnd(tosend);
          }
        }
        if (i > 0) {
          status.comms.runStatus = 'Running'
          send1Q();
        }
      }
    } else {
      console.log('ERROR: Machine connection not open!');
    }
  }); // end socket.onRunCommand

  socket.on('zProbe', function(data) {
    console.log('Probing ' + data.direction + ' down to ' + data.dist + "mm at " + data.feedrate + "mm/min and then subtracting a plate of " + data.plate + "mm")
    status.machine.probe.request = data;
    status.machine.probe.x = 0.00;
    status.machine.probe.y = 0.00;
    status.machine.probe.z = 0.00;
    status.machine.probe.state = -1;
    status.machine.probe.plate = data.plate;
    switch (status.machine.firmware.type) {
      case 'grbl':
        addQToEnd('G10 P1 L20 Z0');
        addQToEnd('G38.2 Z-' + data.dist + ' F' + data.feedrate);
        send1Q();
        break;
      default:
        console.log('ERROR: Unsupported firmware!');
        break;
    }
  }); // end socket.onZProbe

  socket.on('jog', function(data) { // data = {dist: 10, feed: 1000, dir: 'X+'}
    if (status.comms.connectionStatus > 0) {
      var dir = data.dir;
      var dist = parseFloat(data.dist);
      var feed;

      feed = parseInt(data.feed);
      if (feed) {
        feed = 'F' + feed;
      }

      if (dir && dist && feed) {
        switch (status.machine.firmware.type) {
          case 'grbl':
            addQToEnd('$J=G91G21' + dir + dist + feed);
            send1Q();
            break;
          default:
            console.log('ERROR: Unknown firmware!');
            break;
        }
      } else {
        console.log('ERROR: Invalid params!');
      }
    } else {
      console.log('ERROR: Machine connection not open!');
    }
  }); // end socket.onJog

  socket.on('feedOverride', function(data) {
    if (status.comms.connectionStatus > 0) {
      switch (status.machine.firmware.type) {
        case 'grbl':
          console.log("current FRO = " + status.machine.overrides.feedOverride)
          console.log("requested FRO = " + data)
          var curfro = parseInt(status.machine.overrides.feedOverride)
          var reqfro = parseInt(data)
          var delta;

          if (reqfro == 100) {
            addQRealtime(String.fromCharCode(0x90));
          } else if (curfro < reqfro) {
            // FRO Increase
            delta = reqfro - curfro
            console.log("delta = " + delta)
            var tens = Math.floor(delta / 10)

            console.log("need to send " + tens + " x10s increase")
            // for (i = 0; i < tens; i++) {
            //   addQRealtime(String.fromCharCode(0x91));
            // }
            for (let i = 1; i < tens + 1; i++) {
              setTimeout(function timer() {
                addQRealtime(String.fromCharCode(0x91));
                addQRealtime("?");
              }, i * 50);
            }

            var ones = delta - (10 * tens);
            console.log("need to send " + ones + " x1s increase")
            // for (i = 0; i < ones; i++) {
            //   addQRealtime(String.fromCharCode(0x93));
            // }
            for (let i = 1; i < ones + 1; i++) {
              setTimeout(function timer() {
                addQRealtime(String.fromCharCode(0x93));
                addQRealtime("?");
              }, i * 50);
            }
          } else if (curfro > reqfro) {
            // FRO Decrease
            delta = curfro - reqfro
            console.log("delta = " + delta)

            var tens = Math.floor(delta / 10)
            console.log("need to send " + tens + " x10s decrease")
            // for (i = 0; i < tens; i++) {
            //   addQRealtime(String.fromCharCode(0x92));
            // }
            for (let i = 1; i < tens + 1; i++) {
              setTimeout(function timer() {
                addQRealtime(String.fromCharCode(0x92));
                addQRealtime("?");
              }, i * 50);
            }

            var ones = delta - (10 * tens);
            console.log("need to send " + ones + " x1s decrease")
            // for (i = 0; i < tens; i++) {
            //   addQRealtime(String.fromCharCode(0x94));
            // }
            for (let i = 1; i < ones + 1; i++) {
              setTimeout(function timer() {
                addQRealtime(String.fromCharCode(0x94));
                addQRealtime("?");
              }, i * 50);
            }
          }
          addQRealtime("?");
          status.machine.overrides.feedOverride = reqfro // Set now, but will be overriden from feedback from Grbl itself in next queryloop
          break;
      }
    } else {
      console.log('ERROR: Machine connection not open!');
    }
  }); // end socket.onFeedOverride

  socket.on('spindleOverride', function(data) {
    if (status.comms.connectionStatus > 0) {
      switch (status.machine.firmware.type) {
        case 'grbl':
          console.log("current SRO = " + status.machine.overrides.spindleOverride)
          console.log("requested SRO = " + data)
          var cursro = parseInt(status.machine.overrides.spindleOverride)
          var reqsro = parseInt(data)
          var delta;

          if (reqsro == 100) {
            addQRealtime(String.fromCharCode(153));
          } else if (cursro < reqsro) {
            // FRO Increase
            delta = reqsro - cursro
            console.log("delta = " + delta)
            var tens = Math.floor(delta / 10)

            console.log("need to send " + tens + " x10s increase")
            // for (i = 0; i < tens; i++) {
            //   addQRealtime(String.fromCharCode(154));
            // }
            for (let i = 1; i < tens + 1; i++) {
              setTimeout(function timer() {
                addQRealtime(String.fromCharCode(154));
                addQRealtime("?");
              }, i * 50);
            }

            var ones = delta - (10 * tens);
            console.log("need to send " + ones + " x1s increase")
            // for (i = 0; i < ones; i++) {
            //   addQRealtime(String.fromCharCode(156));
            // }
            for (let i = 1; i < ones + 1; i++) {
              setTimeout(function timer() {
                addQRealtime(String.fromCharCode(156));
                addQRealtime("?");
              }, i * 50);
            }
          } else if (cursro > reqsro) {
            // FRO Decrease
            delta = cursro - reqsro
            console.log("delta = " + delta)

            var tens = Math.floor(delta / 10)
            console.log("need to send " + tens + " x10s decrease")
            // for (i = 0; i < tens; i++) {
            //   addQRealtime(String.fromCharCode(155));
            // }
            for (let i = 1; i < tens + 1; i++) {
              setTimeout(function timer() {
                addQRealtime(String.fromCharCode(155));
                addQRealtime("?");
              }, i * 50);
            }

            var ones = delta - (10 * tens);
            console.log("need to send " + ones + " x1s decrease")
            // for (i = 0; i < tens; i++) {
            //   addQRealtime(String.fromCharCode(157));
            // }
            for (let i = 1; i < ones + 1; i++) {
              setTimeout(function timer() {
                addQRealtime(String.fromCharCode(157));
                addQRealtime("?");
              }, i * 50);
            }
          }
          addQRealtime("?");
          status.machine.overrides.spindleOverride = reqsro // Set now, but will be overriden from feedback from Grbl itself in next queryloop
          break;
      }
    } else {
      console.log('ERROR: Machine connection not open!');
    }
  }); // end socket.onSpindleOverride


  socket.on('rapidOverride', function(data) {
    if (status.comms.connectionStatus > 0) {
      switch (status.machine.firmware.type) {
        case 'grbl':
          console.log("current SRO = " + status.machine.overrides.spindleOverride)
          console.log("requested SRO = " + data)
          var currro = parseInt(status.machine.overrides.spindleOverride)
          var reqrro = parseInt(data)
          var delta;

          if (reqrro == 100) {
            addQRealtime(String.fromCharCode(0x95));
          } else if (reqrro == 50) {
            addQRealtime(String.fromCharCode(0x96));
          } else if (reqrro == 25) {
            addQRealtime(String.fromCharCode(0x97));
          }
          addQRealtime("?");
          status.machine.overrides.rapidOverride = reqrro // Set now, but will be overriden from feedback from Grbl itself in next queryloop
          break;
      }
    } else {
      console.log('ERROR: Machine connection not open!');
    }
  }); // end socket.onRapidOverride

  socket.on('pause', function() {
    pause();
  }); // end socket.onPause

  socket.on('resume', function() {
    unpause();
  }); // end socket.onResume

  socket.on('stop', function(data) {
    stop(data);
  }); // end socket.onStop

  socket.on('clearAlarm', function(data) { // Clear Alarm
    if (status.comms.connectionStatus > 0) {
      data = parseInt(data);
      console.log('Clearing Queue: Method ' + data);
      switch (data) {
        case 1:
          console.log('Clearing Lockout');
          switch (status.machine.firmware.type) {
            case 'grbl':
              addQRealtime('$X\n');
              console.log('Sent: $X');
              break;
          }
          console.log('Resuming Queue Lockout');
          break;
        case 2:
          console.log('Emptying Queue');
          status.comms.queue = 0
          queuePointer = 0;
          gcodeQueue.length = 0; // Dump the queue
          sentBuffer.length = 0; // Dump bufferSizes
          queuePointer = 0;
          console.log('Clearing Lockout');
          switch (status.machine.firmware.type) {
            case 'grbl':
              addQRealtime(String.fromCharCode(0x18)); // ctrl-x
              addQRealtime('$X\n');
              console.log('Sent: $X');
              status.comms.blocked = false;
              status.comms.paused = false;
              break;
          }
          break;
      }
      status.comms.runStatus = 'Stopped'
      status.comms.connectionStatus = 2;
    } else {
      console.log('ERROR: Machine connection not open!');
    }
  }); // end socket.onClearAlarm

  socket.on('closePort', function(data) { // Close machine port and dump queue
    if (status.comms.connectionStatus > 0) {
      console.log('WARN: Closing Port ' + port.path);
      stopPort();
    } else {
      console.log('ERROR: Machine connection not open!');
    }
  }); // end socket.onClosePort


  socket.on('runJob', function(data) {
    // console.log(data)
    uploadedgcode = data;
    // console.log('Run Job (' + data.length + ')');
    if (status.comms.connectionStatus > 0) {
      if (data) {
        data = data.split('\n');
        for (var i = 0; i < data.length; i++) {

          var line = data[i].replace("%", "").split(';'); // Remove everything after ; = comment
          var tosend = line[0].trim();
          if (tosend.length > 0) {
            addQToEnd(tosend);
          }
        }
        if (i > 0) {
          // Start interval for qCount messages to socket clients
          queueCounter = setInterval(function() {
            status.comms.queue = gcodeQueue.length - queuePointer
          }, 500);
          send1Q(); // send first line
          status.comms.connectionStatus = 3;
        }

      }
    } else {
      console.log('ERROR: Machine connection not open!');
    }
  }); // end socket.onRunJob

});

function addQToEnd(gcode) {
  // console.log('added ' + gcode)
  gcodeQueue.push(gcode);
}

function addQToStart(gcode) {
  gcodeQueue.unshift(gcode);
}

function addQRealtime(gcode) {
  // realtime command skip the send1Q as it doesnt respond with an ok
  machineSend(gcode);
}

function machineSend(gcode) {
  if (gcode.indexOf("$") != 0) {
    if (gcode.indexOf("G54") != -1 || gcode.indexOf("G55") != -1 || gcode.indexOf("G56") != -1 || gcode.indexOf("G57") != -1 || gcode.indexOf("G58") != -1 || gcode.indexOf("G59") != -1 || gcode.indexOf("G20") != -1 || gcode.indexOf("G21") != -1 || gcode.indexOf("G90") != -1 || gcode.indexOf("G91") != -1 || gcode.indexOf("G93") != -1 || gcode.indexOf("G94") != -1 || gcode.indexOf("M3") != -1 || gcode.indexOf("M4") != -1 || gcode.indexOf("M5") != -1 || gcode.indexOf("M7") != -1 || gcode.indexOf("M8") != -1 || gcode.indexOf("M9") != -1) {
      setTimeout(function() {
        addQRealtime("$G\n");
        addQRealtime("$#\n");
      }, 200)
    }
  }

  // console.log("SENDING: " + gcode)
  if (port.isOpen) {
    var queueLeft = (gcodeQueue.length - queuePointer)
    var queueTotal = gcodeQueue.length
    // console.log("Q: " + queueLeft)
    var data = []
    data.push(queueLeft);
    data.push(queueTotal);
    // console.log(gcode)
    port.write(gcode);
  } else {
    console.log("PORT NOT OPEN")
  }
}


function BufferSpace(firmware) {
  var total = 0;
  var len = sentBuffer.length;
  for (var i = 0; i < len; i++) {
    total += sentBuffer[i].length;
  }
  if (firmware == "grbl") {
    return GRBL_RX_BUFFER_SIZE - total;
  }
}

function stopPort() {
  clearInterval(queueCounter);
  clearInterval(statusLoop);
  status.comms.interfaces.activePort = false;
  status.comms.interfaces.activeBaud = false;
  status.comms.connectionStatus = 0;
  status.machine.firmware.type = "";
  status.machine.firmware.version = ""; // get version
  status.machine.firmware.date = "";
  status.machine.buffer = "";
  gcodeQueue.length = 0;
  sentBuffer.length = 0; // dump bufferSizes

  if (status.comms.interfaces.type == "usb") {
    port.drain(port.close());
  } else if (status.comms.interfaces.type == "telnet") {
    port.destroy();
  }

  status.machine = {
    name: '',
    inputs: [],
    accesories: [],
    overrides: {
      feedOverride: 100, //
      spindleOverride: 100, //
      rapidOverride: 100
    },
    values: {
      realFeed: 0, //
      realSpindle: 0 //
    },
    modals: {
      motionmode: "G0", // G0, G1, G2, G3, G38.2, G38.3, G38.4, G38.5, G80
      coordinatesys: "G54", // G54, G55, G56, G57, G58, G59
      plane: "G17", // G17, G18, G19
      distancemode: "G90", // G90, G91
      arcdistmode: "G91.1", // G91.1
      feedratemode: "G94", // G93, G94
      unitsmode: "G21", // G20, G21
      radiuscomp: "G40", // G40
      tlomode: "G49", // G43.1, G49
      programmode: "M0", // M0, M1, M2, M30
      spindlestate: "M5", // M3, M4, M5
      coolantstate: "M9", // M7, M8, M9
      tool: "0",
      spindle: "0",
      feedrate: "0"
    },
    probe: {
      x: 0.00,
      y: 0.00,
      z: 0.00,
      state: -1,
      plate: 0.00,
      request: {}
    },
    status: {
      work: {
        x: 0,
        y: 0,
        z: 0,
        a: 0,
        e: 0
      },
      offset: {
        x: 0,
        y: 0,
        z: 0,
        a: 0,
        e: 0
      }
    },
    firmware: {
      type: "",
      version: "",
      date: "",
      buffer: [],
      features: [],
      blockBufferSize: "",
      rxBufferSize: "",
    },
  }
}

function send1Q() {
  var gcode;
  var gcodeLen = 0;
  var spaceLeft = 0;
  if (status.comms.connectionStatus > 0) {
    switch (status.machine.firmware.type) {
      case 'grbl':
        if ((gcodeQueue.length - queuePointer) > 0 && !status.comms.blocked && !status.comms.paused) {
          spaceLeft = BufferSpace('grbl');
          if (gcodeQueue[queuePointer].length < spaceLeft) {
            gcode = gcodeQueue[queuePointer];
            queuePointer++;
            sentBuffer.push(gcode);
            machineSend(gcode + '\n');
            // console.log('Sent: ' + gcode + ' Q: ' + (gcodeQueue.length - queuePointer) + ' Bspace: ' + (spaceLeft - gcode.length - 1));
          } else {
            status.comms.blocked = true;
          }
        }
        break;
    }
    if (queuePointer >= gcodeQueue.length) {
      if (!status.comms.connectionStatus == 5) {
        status.comms.connectionStatus = 2; // finished
      }
      clearInterval(queueCounter);
      gcodeQueue.length = 0; // Dump the Queye
      queuePointer = 0;
      status.comms.connectionStatus = 2; // finished
    }
  } else {
    console.log('Not Connected')
  }
}

function parseVersion(data) {
  status.machine.name = data.split(':')[2].split(']')[0].toLowerCase()
  status.machine.firmware.date = data.split(':')[1].split('.')[2].toLowerCase()
}

function parseOpt(data) {
  var startOpt = data.search(/opt:/i) + 4;
  var grblOpt;
  if (startOpt > 4) {
    var grblOptLen = data.substr(startOpt).search(/]/);
    grblOpts = data.substr(startOpt, grblOptLen).split(/,/);

    status.machine.firmware.blockBufferSize = grblOpts[1];
    status.machine.firmware.rxBufferSize = grblOpts[2];

    var features = []

    var i = grblOpts[0].length;
    while (i--) {
      features.push(grblOpts[0].charAt(i))
      switch (grblOpts[0].charAt(i)) {
        case 'Q':
          postLog("features", 'SPINDLE_IS_SERVO Enabled')
          //
          break;
        case 'V': //	Variable spindle enabled
          postLog("features", 'Variable spindle enabled')
          //
          break;
        case 'N': //	Line numbers enabled
          postLog("features", 'Line numbers enabled')
          //
          break;
        case 'M': //	Mist coolant enabled
          postLog("features", 'Mist coolant enabled')
          //
          break;
        case 'C': //	CoreXY enabled
          postLog("features", 'CoreXY enabled')
          //
          break;
        case 'P': //	Parking motion enabled
          postLog("features", 'Parking motion enabled')
          //
          break;
        case 'Z': //	Homing force origin enabled
          postLog("features", 'Homing force origin enabled')
          //
          break;
        case 'H': //	Homing single axis enabled
          postLog("features", 'Homing single axis enabled')
          //
          break;
        case 'T': //	Two limit switches on axis enabled
          postLog("features", 'Two limit switches on axis enabled')
          //
          break;
        case 'A': //	Allow feed rate overrides in probe cycles
          postLog("features", 'Allow feed rate overrides in probe cycles')
          //
          break;
        case '$': //	Restore EEPROM $ settings disabled
          postLog("features", 'Restore EEPROM $ settings disabled')
          //
          break;
        case '#': //	Restore EEPROM parameter data disabled
          postLog("features", 'Restore EEPROM parameter data disabled')
          //
          break;
        case 'I': //	Build info write user string disabled
          postLog("features", 'Build info write user string disabled')
          //
          break;
        case 'E': //	Force sync upon EEPROM write disabled
          postLog("features", 'Force sync upon EEPROM write disabled')
          //
          break;
        case 'W': //	Force sync upon work coordinate offset change disabled
          postLog("features", 'Force sync upon work coordinate offset change disabled')
          //
          break;
        case 'L': //	Homing init lock sets Grbl into an alarm state upon power up
          postLog("features", 'Homing init lock sets Grbl into an alarm state upon power up')
          //
          break;
        case '2': //	Homing init lock sets Grbl into an alarm state upon power up
          postLog("features", 'Dual axis motors,Enabled')
          //
          break;
      }
    }
    status.machine.firmware.features = features;
  }
}

function parseProbe(data) {
  if (status.machine.probe.request.plate) {
    var prbLen = data.substr(5).search(/\]/);
    var prbData = data.substr(5, prbLen).split(/,/);
    var success = data.split(':')[2].split(']')[0];
    status.machine.probe.x = prbData[0];
    status.machine.probe.y = prbData[1];
    status.machine.probe.z = prbData[2];
    status.machine.probe.state = success;
    if (success > 0) {
      postLog("probe", "Probe Completed.  Setting Z to " + status.machine.probe.plate + 'mm')
      addQToEnd('G10 P1 L20 Z' + status.machine.probe.plate);
      send1Q();
    } else {
      postLog("probe", "Probe move aborted - probe did not make contact within specified distance")
    }
    io.sockets.emit('prbResult', status);
    status.machine.probe.request = "";
  }
};

function isGrbl(data) {
  status.comms.blocked = false;
  status.machine.firmware.type = "grbl";
  status.machine.firmware.version = data.substr(5, 4); // get version
  if (parseFloat(status.machine.firmware.version) < 1.1) { // If version is too old
    if (status.machine.firmware.version.length < 3) {
      postLog("connect", "invalid version string, stay connected")
    } else {
      if (status.comms.connectionStatus > 0) {
        console.log('WARN: Closing Port ' + port.path + " /  v" + parseFloat(status.machine.firmware.version));
      } else {
        console.log('ERROR: Machine connection not open!');
      }
      postLog(command, "Detected an unsupported version: Grbl " + status.machine.firmware.version + ". This is sadly outdated. Please upgrade to Grbl 1.1 or newer to use this software.  Go to http://github.com/gnea/grbl")
    }
  }
  status.machine.firmware.date = "";
  addQRealtime("$I\n");
  addQRealtime("$G\n");
  addQRealtime("$#\n");
  console.log("GRBL detected");
  // Start interval for status queries
  statusLoop = setInterval(function() {
    if (status.comms.connectionStatus > 0) {
      addQRealtime("?");
    }
  }, 250);
}

function isSmoothie(data) {
  status.comms.blocked = false;
  console.log("Smoothieware detected: Unsupported");
  status.machine.firmware.type = "smoothie";
  status.machine.firmware.version = data.substr(data.search(/version:/i) + 9).split(/,/);
  status.machine.firmware.date = new Date(data.substr(data.search(/Build date:/i) + 12).split(/,/)).toDateString();
  postLog("FIRMWARE ERROR", "Detected an unsupported version: Smoothieware " + status.machine.firmware.version + ". This software no longer support Smoothieware. \nLuckilly there is an alternative firmware you can install on your controller to make it work with this software. Check out Grbl-LPC at https://github.com/cprezzi/grbl-LPC - Grbl-LPC is a Grbl port for controllers using the NXP LPC176x chips, for example Smoothieboards")
  stopPort();
}

function gotOK(data) {
  if (status.machine.firmware.type === "grbl") {
    command = sentBuffer.shift();
  }
  status.comms.blocked = false;
  send1Q();
}

function gotModals(data) {
  // as per https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands#g---view-gcode-parser-state
  // The shown g-code are the current modal states of Grbl's g-code parser.
  // This may not correlate to what is executing since there are usually
  // several motions queued in the planner buffer.
  // [GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0.0 S0]

  // defaults

  data = data.split(/:|\[|\]/)[2].split(" ")

  for (i = 0; i < data.length; i++) {
    if (data[i] == "G0") {
      status.machine.modals.motionmode = "G0";
    }
    if (data[i] == "G1") {
      status.machine.modals.motionmode = "G1";
    }
    if (data[i] == "G2") {
      status.machine.modals.motionmode = "G2";
    }
    if (data[i] == "G3") {
      status.machine.modals.motionmode = "G3";
    }
    if (data[i] == "G38.2") {
      status.machine.modals.motionmode = "G38.2";
    }
    if (data[i] == "G38.3") {
      status.machine.modals.motionmode = "G38.3";
    }
    if (data[i] == "G38.4") {
      status.machine.modals.motionmode = "G38.4";
    }
    if (data[i] == "G38.5") {
      status.machine.modals.motionmode = "G38.5";
    }
    if (data[i] == "G80") {
      status.machine.modals.motionmode = "G80";
    }

    //   status.machine.modals.coordinatesys = "G54"; // G54, G55, G56, G57, G58, G59
    if (data[i] == "G54") {
      status.machine.modals.coordinatesys = "G54";
    }
    if (data[i] == "G55") {
      status.machine.modals.coordinatesys = "G55";
    }
    if (data[i] == "G56") {
      status.machine.modals.coordinatesys = "G56";
    }
    if (data[i] == "G57") {
      status.machine.modals.coordinatesys = "G57";
    }
    if (data[i] == "G58") {
      status.machine.modals.coordinatesys = "G58";
    }
    if (data[i] == "G59") {
      status.machine.modals.coordinatesys = "G59";
    }

    //   status.machine.modals.plane = "G17"; // G17, G18, G19
    if (data[i] == "G17") {
      status.machine.modals.plane = "G17";
    }
    if (data[i] == "G18") {
      status.machine.modals.plane = "G18";
    }
    if (data[i] == "G19") {
      status.machine.modals.plane = "G19";
    }

    //   status.machine.modals.distancemode = "G90"; // G90, G91
    if (data[i] == "G90") {
      status.machine.modals.distancemode = "G90";
    }
    if (data[i] == "G91") {
      status.machine.modals.distancemode = "G91";
    }

    //   status.machine.modals.arcdistmode = "G91.1"; // G91.1
    if (data[i] == "G91.1") {
      status.machine.modals.arcdistmode = "G91.1";
    }

    //   status.machine.modals.feedratemode = "G94"; // G93, G94
    if (data[i] == "G93") {
      status.machine.modals.feedratemode = "G93";
    }
    if (data[i] == "G94") {
      status.machine.modals.feedratemode = "G94";
    }

    //   status.machine.modals.unitsmode = "G21"; // G20, G21
    if (data[i] == "G20") {
      status.machine.modals.unitsmode = "G20";
    }
    if (data[i] == "G21") {
      status.machine.modals.unitsmode = "G21";
    }

    //   status.machine.modals.radiuscomp = "G40"; // G40
    if (data[i] == "G40") {
      status.machine.modals.radiuscomp = "G40";
    }

    //   status.machine.modals.tlomode = "G49"; // G43.1, G49
    if (data[i] == "G49") {
      status.machine.modals.tlomode = "G49";
    }
    if (data[i] == "G43.1") {
      status.machine.modals.tlomode = "G43.1";
    }

    //   status.machine.modals.programmode = "M0"; // M0, M1, M2, M30
    if (data[i] == "M0") {
      status.machine.modals.programmode = "M0";
    }
    if (data[i] == "M1") {
      status.machine.modals.programmode = "M1";
    }
    if (data[i] == "M2") {
      status.machine.modals.programmode = "M2";
    }
    if (data[i] == "M30") {
      status.machine.modals.programmode = "M30";
    }

    //   status.machine.modals.spindlestate = "M5"; // M3, M4, M5
    if (data[i] == "M3") {
      status.machine.modals.spindlestate = "M3";
    }
    if (data[i] == "M4") {
      status.machine.modals.spindlestate = "M4";
    }
    if (data[i] == "M5") {
      status.machine.modals.spindlestate = "M5";
    }

    //   status.machine.modals.coolantstate = "M9"; // M7, M8, M9
    if (data[i] == "M7") {
      status.machine.modals.coolantstate = "M7";
    }
    if (data[i] == "M8") {
      status.machine.modals.coolantstate = "M8";
    }
    if (data[i] == "M9") {
      status.machine.modals.coolantstate = "M9";
    }

    //   status.machine.modals.tool = "0",
    if (data[i].indexOf("T") === 0) {
      status.machine.modals.tool = parseFloat(data[i].substr(1))
    }

    //   status.machine.modals.spindle = "0"
    if (data[i].indexOf("S") === 0) {
      status.machine.modals.spindle = parseFloat(data[i].substr(1))
    }

    //   status.machine.modals.feedrate = "0"
    if (data[i].indexOf("F") === 0) {
      status.machine.modals.feedrate = parseFloat(data[i].substr(1))
    }
  }




}

function gotCoords(data) {
  // todo - add to status JSON
  // [G54:4.000,0.000,0.000]
  // [G55:4.000,6.000,7.000]
  // [G56:0.000,0.000,0.000]
  // [G57:0.000,0.000,0.000]
  // [G58:0.000,0.000,0.000]
  // [G59:0.000,0.000,0.000]
  // [G28:1.000,2.000,0.000]
  // [G30:4.000,6.000,0.000]
  // [G92:0.000,0.000,0.000]
  // [TLO:0.000]
  // [PRB:0.000,0.000,0.000:0]
  console.log("Output of $#:")
  console.log(data)
}

function gotMessage(data) {
  if (data.indexOf("[MSG:Reset to continue]") === 0) {
    postLog("reset", "[MSG:Reset to continue] -> Sending Reset")
    addQRealtime(String.fromCharCode(0x18)); // ctrl-x
  }
}

function gotAlarm(data) {
  status.comms.connectionStatus = 5;
  switch (status.machine.firmware.type) {
    case 'grbl':
      // sentBuffer.shift();
      var alarmCode = parseInt(data.split(':')[1]);
      status.comms.alarm = alarmCode + ' - ' + grblStrings.alarms(alarmCode)
      postLog(command, 'ALARM: ' + alarmCode + ' - ' + grblStrings.alarms(alarmCode))
      break;
  }
  status.comms.connectionStatus = 5;
}

function gotError(data) {
  switch (status.machine.firmware.type) {
    case 'grbl':
      var errorCode = parseInt(data.split(':')[1]);
      postLog(command, 'error: ' + errorCode + ' - ' + grblStrings.errors(errorCode))
      break;
  }
  sentBuffer.shift();
  status.comms.connectionStatus = 5;
}

function parseFeedback(data) {
  // console.log(data)
  var state = data.substring(1, data.search(/(,|\|)/));
  status.comms.runStatus = state
  if (state == "Alarm") {
    // console.log("ALARM:  " + data)
    status.comms.connectionStatus = 5;
    switch (status.machine.firmware.type) {
      case 'grbl':
        // sentBuffer.shift();
        var alarmCode = parseInt(data.split(':')[1]);
        // console.log('ALARM: ' + alarmCode + ' - ' + grblStrings.alarms(alarmCode));
        status.comms.alarm = alarmCode + ' - ' + grblStrings.alarms(alarmCode)
        break;
    }
    status.comms.connectionStatus = 5;
  }
  if (status.machine.firmware.type == "grbl") {
    // Extract work offset (for Grbl > 1.1 only!)
    var startWCO = data.search(/wco:/i) + 4;
    var wco;
    if (startWCO > 4) {
      wco = data.replace(">", "").substr(startWCO).split(/,|\|/, 4);
    }
    if (Array.isArray(wco)) {
      xOffset = parseFloat(wco[0]).toFixed(3);
      yOffset = parseFloat(wco[1]).toFixed(3);
      zOffset = parseFloat(wco[2]).toFixed(3);
      if (has4thAxis) {
        aOffset = parseFloat(wco[3]).toFixed(3);
        status.machine.status.offset.x = xOffset;
        status.machine.status.offset.y = yOffset;
        status.machine.status.offset.z = zOffset;
        status.machine.status.offset.a = aOffset;
      } else {
        status.machine.status.offset.x = xOffset;
        status.machine.status.offset.y = yOffset;
        status.machine.status.offset.z = zOffset;
      }
    }
    // Extract wPos (for Grbl > 1.1 only!)
    var startWPos = data.search(/wpos:/i) + 5;
    var wPos;
    if (startWPos > 5) {
      var wPosLen = data.substr(startWPos).search(/>|\|/);
      wPos = data.substr(startWPos, wPosLen).split(/,/);
    }
    var startMPos = data.search(/mpos:/i) + 5;
    var mPos;
    if (startMPos > 5) {
      var mPosLen = data.substr(startMPos).search(/>|\|/);
      mPos = data.substr(startMPos, mPosLen).split(/,/);
    }
    // If we got a WPOS
    if (Array.isArray(wPos)) {
      // console.log('wpos')
      if (xPos !== parseFloat(wPos[0]).toFixed(3)) {
        xPos = parseFloat(wPos[0]).toFixed(3);
      }
      if (yPos !== parseFloat(wPos[1]).toFixed(3)) {
        yPos = parseFloat(wPos[1]).toFixed(3);
      }
      if (zPos !== parseFloat(wPos[2]).toFixed(3)) {
        zPos = parseFloat(wPos[2]).toFixed(3);
      }
      if (wPos.length > 3) {
        if (aPos !== parseFloat(wPos[3]).toFixed(3)) {
          aPos = parseFloat(wPos[3]).toFixed(3);
          has4thAxis = true;
        }
      }
      if (has4thAxis) {
        status.machine.status.work.x = xPos
        status.machine.status.work.y = yPos
        status.machine.status.work.z = zPos
        status.machine.status.work.a = aPos
      } else {
        status.machine.status.work.x = xPos
        status.machine.status.work.y = yPos
        status.machine.status.work.z = zPos
      }
      // end is WPOS
    } else if (Array.isArray(mPos)) {
      // console.log('mpos', mPos)
      if (xPos !== parseFloat(mPos[0]).toFixed(3)) {
        xPos = parseFloat(mPos[0]).toFixed(3);
      }
      if (yPos !== parseFloat(mPos[1]).toFixed(3)) {
        yPos = parseFloat(mPos[1]).toFixed(3);
      }
      if (zPos !== parseFloat(mPos[2]).toFixed(3)) {
        zPos = parseFloat(mPos[2]).toFixed(3);
      }
      if (mPos.length > 3) {
        if (aPos !== parseFloat(mPos[3]).toFixed(3)) {
          aPos = parseFloat(mPos[3]).toFixed(3);
          has4thAxis = true;
        }
      }
      if (has4thAxis) {
        status.machine.status.work.x = parseFloat(xPos - status.machine.status.offset.x).toFixed(3)
        status.machine.status.work.y = parseFloat(yPos - status.machine.status.offset.y).toFixed(3)
        status.machine.status.work.z = parseFloat(zPos - status.machine.status.offset.z).toFixed(3)
        status.machine.status.work.a = parseFloat(aPos - status.machine.status.offset.a).toFixed(3)
      } else {
        status.machine.status.work.x = parseFloat(xPos - status.machine.status.offset.x).toFixed(3)
        status.machine.status.work.y = parseFloat(yPos - status.machine.status.offset.y).toFixed(3)
        status.machine.status.work.z = parseFloat(zPos - status.machine.status.offset.z).toFixed(3)
      }
      // end if MPOS
    }

  }

  // Extract override values (for Grbl > v1.1 only!)
  var startOv = data.search(/ov:/i) + 3;
  if (startOv > 3) {
    var ov = data.replace(">", "").substr(startOv).split(/,|\|/, 3);
    if (Array.isArray(ov)) {
      if (ov[0]) {
        status.machine.overrides.feedOverride = ov[0];
      }
      if (ov[1]) {
        status.machine.overrides.rapidOverride = ov[1];
      }
      if (ov[2]) {
        status.machine.overrides.spindleOverride = ov[2];
      }
    }
  }
  // Extract realtime Feed and Spindle (for Grbl > v1.1 only!)
  var startFS = data.search(/FS:/i) + 3;
  if (startFS > 3) {
    var fs = data.replace(">", "").substr(startFS).split(/,|\|/);
    if (Array.isArray(fs)) {
      if (fs[0]) {
        status.machine.status.realFeed = fs[0];
      }
      if (fs[1]) {
        status.machine.status.realSpindle = fs[1];
      }
    }
  }

  // extras realtime feed (if variable spindle is disabled)
  var startF = data.search(/F:/i) + 2;
  if (startF > 2) {
    var f = data.replace(">", "").substr(startF).split(/,|\|/);
    if (Array.isArray(f)) {
      if (fs[0]) {
        status.machine.status.realFeed = fs[0];
      }
    }
  }

  // extras Accesories
  // S indicates spindle is enabled in the CW direction. This does not appear with C.
  // C indicates spindle is enabled in the CCW direction. This does not appear with S.
  // F indicates flood coolant is enabled.
  // M indicates mist coolant is enabled.
  var startA = data.search(/A:/i) + 2;
  if (startA > 2) {
    var a = data.replace(">", "").substr(startA).split(/,|\|/);
    var accesories = []
    var i = a[0].length;
    while (i--) {
      accesories.push(a[0].charAt(i))
    }
    status.machine.accesories = accesories;
  }

  // Extract Pin Data
  var startPin = data.search(/Pn:/i) + 3;
  if (startPin > 3) {
    var pinsdata = data.replace(">", "").replace("\r", "").substr(startPin).split(/,|\|/, 1);
    var pins = pinsdata[0].split('')
    status.machine.inputs = pins;
    if (!_.isEqual(pins, oldpinslist)) {
      if (pins.includes('H')) {
        // pause
        pause();
        postLog('external from hardware', "Application received a FEEDHOLD notification from Grbl")
      } // end if HOLD

      if (pins.includes('R')) {
        // abort
        stop(true);
        postLog('external from hardware', "Application received a RESET/ABORT notification from Grbl")
      } // end if ABORT

      if (pins.includes('S')) {
        // abort
        unpause();
        postLog('external from hardware', "Application received a CYCLESTART/RESUME notification from Grbl")
      } // end if RESUME/START
    }
  } else {
    status.machine.inputs = [];
  }
  oldpinslist = pins;
  // Extract Buffer Data
  var startBuf = data.search(/Bf:/i) + 3;
  if (startBuf > 3) {
    var buffer = data.replace(">", "").replace("\r", "").substr(startBuf).split(/,|\|/, 2);
    status.machine.buffer = buffer;
  } else {
    status.machine.buffer = [];
  }
  // end statusreport
}

function stop(jog) {
  if (status.comms.connectionStatus > 0) {
    status.comms.paused = true;
    console.log('STOP');
    switch (status.machine.firmware.type) {
      case 'grbl':
        if (jog) {
          addQRealtime(String.fromCharCode(0x85)); // canceljog
          console.log('Sent: 0x85 Jog Cancel');
        } else {
          addQRealtime('!'); // hold
          console.log('Sent: !');
        }
        if (status.machine.firmware.version === '1.1d') {
          addQRealtime(String.fromCharCode(0x9E)); // Stop Spindle/Laser
          console.log('Sent: Code(0x9E)');
        }
        console.log('Cleaning Queue');
        if (!jog) {
          addQRealtime(String.fromCharCode(0x18)); // ctrl-x
          console.log('Sent: Code(0x18)');
        }
        status.comms.connectionStatus = 2;
        break;
    }
    clearInterval(queueCounter);
    status.comms.queue = 0
    queuePointer = 0;
    gcodeQueue.length = 0; // Dump the queue
    sentBuffer.length = 0; // Dump the queue
    // sentBuffer.length = 0; // Dump bufferSizes
    laserTestOn = false;
    status.comms.blocked = false;
    status.comms.paused = false;
    status.comms.runStatus = 'Stopped';
  } else {
    console.log('ERROR: Machine connection not open!');
  }
}

function pause() {
  if (status.comms.connectionStatus > 0) {
    status.comms.paused = true;
    console.log('PAUSE');
    switch (status.machine.firmware.type) {
      case 'grbl':
        addQRealtime('!'); // Send hold command
        console.log('Sent: !');
        if (status.machine.firmware.version === '1.1d') {
          addQRealtime(String.fromCharCode(0x9E)); // Stop Spindle/Laser
          console.log('Sent: Code(0x9E)');
        }
        break;
    }
    status.comms.runStatus = 'Paused';
    status.comms.connectionStatus = 4;
  } else {
    console.log('ERROR: Machine connection not open!');
  }
}

function unpause() {
  if (status.comms.connectionStatus > 0) {
    console.log('UNPAUSE');
    switch (status.machine.firmware.type) {
      case 'grbl':
        addQRealtime('~'); // Send resume command
        console.log('Sent: ~');
        break;
    }
    status.comms.paused = false;
    status.comms.blocked = false;
    setTimeout(function() {
      send1Q(); // restart queue
    }, 200);
    status.comms.runStatus = 'Resuming';
    status.comms.connectionStatus = 3;
  } else {
    console.log('ERROR: Machine connection not open!');
  }
}

function portOpened(port, data) {
  postLog("connect", "PORT INFO: Port is now open: " + port.path + " - Attempting to detect Firmware")
  postLog("connect", "Checking for firmware on " + port.path);
  status.comms.connectionStatus = 1;
  addQRealtime("\n"); // this causes smoothie to send the welcome string
  postLog("connect", "Detecting Firmware: Method 1 (Autoreset)")
  setTimeout(function() { //wait for controller to be ready
    if (status.machine.firmware.type.length < 1) {
      postLog("connect", "Detecting Firmware: Method 2 (Ctrl+X)")
      addQRealtime(String.fromCharCode(0x18)); // ctrl-x (needed for rx/tx connection)
    }
  }, 1000);
  setTimeout(function() {
    // Close port if we don't detect supported firmware after 2s.
    if (status.machine.firmware.type.length < 1) {
      postLog("connect", "ERROR:  No supported firmware detected  - You need a controller running Grbl 1.1x. Closing port " + status.comms.interfaces.activePort)
      stopPort();
    } else {
      postLog("connect", "Firmware Detected:  " + status.machine.firmware.type + " version " + status.machine.firmware.version + " on " + status.comms.interfaces.activePort)
    }
  }, 2000);
  status.comms.connectionStatus = 2;
  if (data.type == "usb") {
    status.comms.interfaces.activePort = port.path;
    status.comms.interfaces.type = data.type
  } else if (data.type = "telnet") {
    status.comms.interfaces.activePort = data.ip;
    status.comms.interfaces.type = data.type
  }
  status.comms.interfaces.activeBaud = port.baudRate;
}

function postLog(source, data) {
  var output = {
    'command': source,
    'response': data
  }
  io.sockets.emit('data', output);
}