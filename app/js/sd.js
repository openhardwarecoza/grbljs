$(document).ready(function() {
  var fileOpen = document.getElementById('file');
  if (fileOpen) {
    fileOpen.addEventListener('change', readFile, false);
  }

});

function readFile(evt) {
  console.group("New FileOpen Event:");
  console.log(evt);
  console.groupEnd();
  var files = evt.target.files || evt.dataTransfer.files;
  for (var i = 0; i < files.length; i++) {
    loadFile(files[i]);
  }
  document.getElementById('file').value = '';
}

function loadFile(f) {
  // Filereader
  // console.log("Sending ", f)
  if (f) {
    var r = new FileReader();
    r.readAsText(f);
    r.onload = function(event) {
      // console.log(this.result, f.name)
      sendGcodeToMyMachine(this.result, f.name);
    };
  }
}


function sendGcodeToMyMachine(gcode, filename) {
  socket.emit("esp32upload", {
    url: "http://" + laststatus.machine.firmware.ipaddress +
      "/upload",
    filename: filename,
    gcode: gcode
  })
}

function sdCardList(sdcardlist) {
  console.log(sdcardlist)
  $("#sdcardlist").empty()
  var template = ``
  for (i = 0; i < sdcardlist.filelist.length; i++) {
    var data = sdcardlist.filelist[i].split(/:|\||\]/)
    var bytes = formatBytes(data[3])
    if (data[1].indexOf("/System Volume Information/") == -1) {
      console.log(data[1], data[3])
      template += `
      <tr>
        <td><i class="far fa-file"></i></td>
        <td><a href="http://` + laststatus.machine.firmware.ipaddress + `/SD` + data[1] + `">` + data[1] + `</a></td>
        <td>` + bytes + `</td>
        <td>
          <div class="button-group">
            <button class="sdbtn sdplay ripple button-group-item" onclick="runSDFile('` + data[1] + `')" id="sdplay` + i + `"><i class="fas fa-play"></i></button>
          </div>
        </td>

      </tr>
      `
    }

  }
  $("#sdcardlist").html(template)
}

function runSDFile(filename) {
  socket.emit('runCommand', '[ESP220]' + filename)
}

function processSDStatus(status) {
  if (status.machine.sdcard.status) {
    printLog("[SD CARD PROGRESS] " + status.machine.sdcard.status[0] + "%")
    $('.sdplay').prop('disabled', true);
  } else {
    $('.sdplay').prop('disabled', false);
  }
}