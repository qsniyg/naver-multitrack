const request = require('request');
const parseString = require('xml2js').parseString;
var xmldoc = require('xmldoc');
const express = require('express');
const app = express();
const port = 4522;
const child_process = require("child_process");


var request_vodinfo = function(data, cb) {
  var url = "https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0/";
  url += data.vid;
  url += "?key=" + data.key;

  request(url, function (error, response, body) {
    if (error) {
      console.error(error);
      return cb(null);
    }

    try {
      var json = JSON.parse(body);
      cb(json.meta.multitrack.source);
    } catch (e) {
      console.error(e);
      return cb(null);
    }
  });
};

var request_hls = function(url, cb) {
  request(url, function (error, response, body) {
    if (error) {
      console.error(error);
      return cb(null);
    }

    return cb(body.toString());
  });
};

var final_tracks = [];
var failed = [];

var request_multitrack = function(url, cb) {
  request(url, function (error, response, body) {
    if (error) {
      console.error(error);
      return cb(null);
    }

    //console.log(body);

    //var xmlDoc = libxmljs.parseXml(body);
    var document = new xmldoc.XmlDocument(body);
    //console.log(document);

    var mtvid = document.childNamed("multiTrackVideo");
    //console.log(mtvid.children);

    var fnlist = mtvid.childNamed("fileNameList");
    var qualities = [];
    fnlist.childrenNamed("m3u8").forEach((m3u8) => {
      qualities.push(m3u8);
    });

    qualities.sort((a, b) => {
      return parseInt(b.childNamed("qualityId").val) - parseInt(a.childNamed("qualityId").val);
    });

    //console.log(qualities);
    console.log("Selecting quality: ", qualities[0].childNamed("qualityId").val);
    var path = qualities[0].childNamed("path").val;
    console.log("Path: ", path);
    //console.log(JSON.parse(JSON.stringify(parseString(body))));

    request_hls(path, function(hls) {
      if (!hls) {
        return cb(null);
      }

      var tracklist = mtvid.childNamed("trackList");
      tracklist.childrenNamed("track").forEach((track) => {
        title = track.childNamed("title").val;

        var qualitylist = track.childNamed("qualityList");
        var track_qualities = [];
        qualitylist.childrenNamed("quality").forEach((quality) => {
          track_qualities.push(quality);
        });

        track_qualities.sort((a, b) => {
          return parseInt(b.childNamed("id").val) - parseInt(a.childNamed("id").val);
        });

        console.log("Selecting quality:", track_qualities[0].childNamed("id").val, "for", title);
        var track_path_head = track_qualities[0].childNamed("path").val;
        console.log(track_path_head);

        var track_hls = hls.replace(/(sample-[0-9]+\.ts)/g, function(x) {
          return track_path_head + "&filename=" + x;
        });

        final_tracks.push({
          title: title,
          hls: track_hls
        });
      });

      //console.log(final_tracks);

      var current_id = 0;
      var do_ffmpeg = function() {
        run_ffmpeg(current_id, function(code) {
          if (code !== 0) {
            failed.push(current_id);
          }

          current_id++;
          if (current_id < final_tracks.length) {
            do_ffmpeg();
          } else {
            if (failed.length > 0) {
              console.log("Failed to download:");
              failed.forEach(failure => {
                console.log(failure + " " + final_tracks[failure].title);
              });
            }

            process.exit();
          }
        });
      };

      do_ffmpeg();
    });
  });
};

var request_naver = function(url, cb) {
  request(url, function (error, response, body) {
    if (error) {
      console.error(error);
      return cb(null);
    }

    var match = body.match(/new nhn\.rmcnmv\.RMCVideoPlayer\("([0-9A-F]{20,})", "(V[0-9a-f]{20,})",/);
    if (!match) {
      console.error("Unable to find match for", url);
      return cb(null);
    }

    var data = {
      vid: match[1],
      key: match[2]
    };

    request_vodinfo(data, function(multitrack_url) {
      if (!multitrack_url)
        return cb(null);

      request_multitrack(multitrack_url, cb);
    });
  });
};

request_naver(process.argv[2], function(data) {
  console.log("data", data);
});

app.get("/:id/file.m3u8", (req, res) => {
  var id = req.params.id;
  res.send(final_tracks[id].hls);
});

app.listen(port, () => console.log(`Server listening at http://localhost:${port}`));

var run_ffmpeg = function(id, cb) {
  var ffmpeg = child_process.spawn("ffmpeg", ["-i", "http://localhost:" + port + "/" + id + "/file.m3u8", "-c", "copy", id + " " + final_tracks[id].title + ".mp4", "-y"], {
    stdio: [process.stdin, process.stdout, process.stderr]
  });
  ffmpeg.on("close", cb);
};
