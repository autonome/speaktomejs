/*

TODO:

* test and fix multiple starts (.busy)
* support stop recording on timeout by config
* support stop on VAD by config
* support continuous (throttle api calls)


states/events

* ready
* listening
* heard
* sending
* sent
* received


*/

(function speak_to_me(exports) {

  var STT_SERVER_URL = "https://speaktome.services.mozilla.com";

  // Lazy initialized in stm_start()
  var VAD = null;

  function start() {
    var constraints = { audio: true };

    // Lazy init VAD on first-use
    if (!VAD) {
      VAD = SpeakToMeVAD.SpeakToMeVAD();
    }

    // TODO: wrapper for vendor support
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(onStream)
      .catch(function(err) {
        console.error(err);
      });
  }

  function onStream(stream) {
    // Stored data from mediarecorder
    var chunks = [];

    // Build the WebAudio graph we'll be using
    var audioContext = new AudioContext();
    var sourceNode = audioContext.createMediaStreamSource(stream);
    var analyzerNode = audioContext.createAnalyser();
    var outputNode = audioContext.createMediaStreamDestination();

    // make sure we're doing mono everywhere
    sourceNode.channelCount = 1;
    analyzerNode.channelCount = 1;
    outputNode.channelCount = 1;

    // connect the nodes together
    sourceNode.connect(analyzerNode);
    analyzerNode.connect(outputNode);

    // VAD initializations
    // console.log("Sample rate: ", audioContext.sampleRate);
    var bufferSize = 2048;
    // create a javascript node
    var scriptprocessor = audioContext.createScriptProcessor(
        bufferSize,
        1,
        1
        );

    // Send audio events to VAD, which will call onVADComplete
    // when either voice input ends, none is detected, or neither (timeout).
    scriptprocessor.onaudioprocess = VAD.onAudioProcessingEvent;

    // VAD result handler
    function onVADComplete(reason) {
      console.log('onVADComplete', reason);
      stopGum();
      //mediaRecorder.stop();
    }
    VAD.setOnComplete(onVADComplete);

    // connect stream to our recorder
    sourceNode.connect(scriptprocessor);

    // and set up the recorder
    var options = {
      audioBitsPerSecond: 16000,
      mimeType: "audio/ogg"
    };

    // MediaRecorder initialization
    var mediaRecorder = new MediaRecorder(
      outputNode.stream,
      options
    );

    function stopGum() {
      console.log("stopGum");
      mediaRecorder.stop();
      sourceNode.disconnect(scriptprocessor);
      sourceNode.disconnect(analyzerNode);
      analyzerNode.disconnect(outputNode);
      console.log("Gum stopped");
    }

    mediaRecorder.start();

    // TODO: hack until VAD is hooked up correctly
    //setTimeout(stopGum, 5000);

    mediaRecorder.onstop = function(e) {
      console.log('onstop', e.target);
      console.log("mediaRecorder onStop");

      // We stopped the recording, send the content to the STT server.
      processResult();

      mediaRecorder = null;
      audioContext = null;
      sourceNode = null;
      analyzerNode = null;
      outputNode = null;
      stream = null;
      scriptprocessor = null;
    };

    function processResult() {
      var blob = new Blob(chunks, {
        type: "audio/ogg; codecs=opus"
      });
      chunks = [];

      fetch(STT_SERVER_URL, {
        method: "POST",
        body: blob
      })
      .then(function(response) {
        return response.json();
      })
      .then(function(json) {
        console.log(
          'Got STT result:', JSON.stringify(json)
        );

        if (json.status === "ok") {
          resultHandler(json.data);
        }
      })
      .catch(function(error) {
        console.error('Fetch error:', error);
      });
    }

    mediaRecorder.ondataavailable = function(e) {
      chunks.push(e.data);
    };
  }

  function resultHandler(data) {
    console.warn('SpeakToMe: You need to set a result handler with setResultHandler!');
  }

  function setResultHandler(cb) {
    resultHandler = cb;
  }

  // Public
  exports.SpeakToMe = function SpeakToMe(options) {

    // TODO: not wired up yet
    // Configuration options
    if (options) {
      if (options.stopOnVAD) {
        cfg.stopOnVAD = true;
      }
      else if (options.stopOnTimeout) {
        // TODO: validate input
        cfg.stopOnTimeout = options.stopOnTimeout;
      }
      else if (options.continuous) {
        cfg.continuous = true;
      }
    }

    return {
      start: start,
      setResultHandler: setResultHandler
      // TODO
      // stop: stop,
    };
  };

})(window);
