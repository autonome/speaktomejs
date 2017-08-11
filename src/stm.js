/*

TODO:

* support multiple listen() (check state)
* support manual stop listening (overrides others, has timeout)
* support continuous (throttle api calls)
* break out API separate from web, for node env module


states/events

* ready
* listening
* processing
* sending
* waitingonserver
* result


*/

var STT_SERVER_URL = 'https://speaktome.services.mozilla.com';

var RECORDING_TIMEOUT = 3000;

var RECORDING_BITS_PER_SECOND = 16000;

var RECORDING_MIME_TYPE = 'audio/ogg';

(function initCompat() {
  // Older browsers might not implement mediaDevices at all, so we set an empty object first
  if (navigator.mediaDevices === undefined) {
    navigator.mediaDevices = {};
  }

  // Some browsers partially implement mediaDevices. We can't just assign an object
  // with getUserMedia as it would overwrite existing properties.
  // Here, we will just add the getUserMedia property if it's missing.
  if (navigator.mediaDevices.getUserMedia === undefined) {
    navigator.mediaDevices.getUserMedia = function(constraints) {

      // First get ahold of the legacy getUserMedia, if present
      var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

      // Some browsers just don't implement it - return a rejected promise with an error
      // to keep a consistent interface
      if (!getUserMedia) {
        return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
      }

      // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
      return new Promise(function(resolve, reject) {
        getUserMedia.call(navigator, constraints, resolve, reject);
      });
    }
  }
})();

function SpeakToMe(options) {

  // Default config
  var config = {
    vad: true,
    timeout: RECORDING_TIMEOUT,
    continuous: false,
    serverURL: STT_SERVER_URL,
    listener: null
  };

  // Caller options
  if (options) {
    if (options.vad === false) {
      config.vad = false;
    }
    if (options.timeout) {
      // TODO: validate
      config.timeout = options.timeout;
    }
    if (options.listener) {
      config.listener = options.listener;
    }
  }

  var states = [
    'ready',
    'listening',
    'sending',
    'waitingonserver',
    'receiving'
  ];

  // Lazy initialized in start()
  var VAD = null;

  function listen() {
    // Lazy init VAD on first-use
    if (config.vad && !VAD) {
      VAD = SpeakToMeVAD.SpeakToMeVAD();
    }

    // Configure constraints
    var constraints = { audio: true };

    // Start listening
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(onStream)
      .catch(function(err) {
        console.error(err);
      });
  }

  function onStream(stream) {
    messageListener({ state: 'listening'});

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

    // So we can destroy it later
    var scriptprocessor;

    if (config.vad) {
      // VAD initializations
      // console.log("Sample rate: ", audioContext.sampleRate);
      var bufferSize = 2048;
      // create a javascript node
      scriptprocessor = audioContext.createScriptProcessor(
          bufferSize, 1, 1);

      // Send audio events to VAD, which will call onVADComplete
      // when either voice input ends, none is detected, or neither (timeout).
      scriptprocessor.onaudioprocess = VAD.onAudioProcessingEvent;

      // VAD result handler
      function onVADComplete(reason) {
        //console.log('onVADComplete', reason);
        stopRecording();
      }
      VAD.setOnComplete(onVADComplete);

      // connect stream to our recorder
      sourceNode.connect(scriptprocessor);
    }

    // Set up the recorder
    var options = {
      audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
      mimeType: RECORDING_MIME_TYPE
    };

    // MediaRecorder initialization
    var mediaRecorder = new MediaRecorder(
      outputNode.stream,
      options
    );

    function stopRecording() {
      //console.log("stopRecording");
      stream.getAudioTracks()[0].stop();
      mediaRecorder.stop();
      sourceNode.disconnect(scriptprocessor);
      sourceNode.disconnect(analyzerNode);
      analyzerNode.disconnect(outputNode);
      //console.log("Stopped recording");
    }

    mediaRecorder.start();

    // If VAD is disabled, stop recording on a timeout
    if (!config.vad) {
      setTimeout(stopRecording, config.timeout);
    }

    mediaRecorder.onstop = function(e) {
      //console.log('onstop', e.target);
      //console.log("mediaRecorder onStop");

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

    // Stored data from mediarecorder
    var chunks = [];

    mediaRecorder.ondataavailable = function(e) {
      chunks.push(e.data);
    };

    function processResult() {
      messageListener({ state: 'processing'});

      // Create blob from recording, for upload
      var blob = new Blob(chunks, {
        type: "audio/ogg; codecs=opus"
      });

      // Reset recording buffer
      chunks = [];

      messageListener({ state: 'sending'});

      fetch(config.serverURL, {
        method: "POST",
        body: blob
      })
      .then(function(response) {
        return response.json();
      })
      .then(function(json) {
        if (json.status === "ok") {
          messageListener({ state: 'result', data: json.data});
        }
        else {
          console.error('Error parsing JSON response:', error);
        }
      })
      .catch(function(error) {
        console.error('Fetch error:', error);
      });
    }
  }

  // Default result handler - replaced by consumer
  function resultHandler(data) {
    console.warn('SpeakToMe: You need to set a result handler with setResultHandler!');
  }

  function messageListener(msg) {
    if (!config.listener) {
      return;
    }

    try {
      config.listener(msg);
    }
    catch(ex) {
      console.error('SpeakToMe: Listener error', ex);
    }
  }

  // Public API
  return {
    listen: listen,
    // TODO: fixme
    //stop: stopRecording
  };

}

if (typeof(module) != "undefined") {
  module.exports = SpeakToMe;
}
