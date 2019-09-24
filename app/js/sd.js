function sendGcodeToMyMachine(gcode) {
  var textToWrite = "gcode";
  var blob = new Blob([textToWrite], {
    type: "text/plain"
  });
  console.log("Sending ", blob, " to https://192.168.89.253")
  var url = "http://192.168.89.253/upload"
  var fd = new FormData();
  var time = new Date();
  var string = "filename.gcode"
  console.log(string)
  fd.append('data', blob, string);
  $.ajax({
    type: 'POST',
    url: url,
    data: fd,
    processData: false,
    contentType: false
  }).done(function(data) {
    // console.log(data);
    console.log('GCODE Successfully sent to OpenBuilds CONTROL! Continue from the OpenBuilds CONTROL window');
  });
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