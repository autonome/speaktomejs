(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.SpeakToMe = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

},{}],2:[function(require,module,exports){
var SpeakToMeVAD = (function() {
  // Webrtc_Vad integration
  function SpeakToMeVAD() {
    var webrtc_main = Module.cwrap("main");
    webrtc_main();

    var webrtc_setmode = Module.cwrap("setmode", "number", ["number"]);
    // set_mode defines the aggressiveness degree of the voice activity detection algorithm
    // for more info see: https://github.com/mozilla/gecko/blob/central/media/webrtc/trunk/webrtc/common_audio/vad/vad_core.h#L68
    webrtc_setmode(3);

    var webrtc_process_data = Module.cwrap("process_data", "number", [
        "number",
        "number",
        "number",
        "number",
        "number",
        "number"
    ]);

    // frame length that should be passed to the vad engine. Depends on audio sample rate
    // https://github.com/mozilla/gecko/blob/central/media/webrtc/trunk/webrtc/common_audio/vad/vad_core.h#L106
    var sizeBufferVad = 480;
    //
    var buffer_vad = new Int16Array(sizeBufferVad);
    //
    var leftovers = 0;
    //
    var finishedVoice = false;
    //
    var samplesvoice = 0;
    //
    var touchedvoice = false;
    //
    var touchedsilence = false;
    //
    var dtantes = Date.now();
    //
    var dtantesmili = Date.now();
    //
    var raisenovoice = false;
    //
    var done = false;
    // minimum of voice (in milliseconds) that should be captured to be considered voice
    var minvoice = 250;
    // max amount of silence (in milliseconds) that should be captured to be considered end-of-speech
    var maxsilence = 1500;
    // max amount of capturing time (in seconds)
    var maxtime = 6;

    function reset() {
      buffer_vad = new Int16Array(sizeBufferVad);
      leftovers = 0;
      finishedvoice = false;
      samplesvoice = 0;
      samplessilence = 0;
      touchedvoice = false;
      touchedsilence = false;
      dtantes = Date.now();
      dtantesmili = Date.now();
      raisenovoice = false;
      done = false;
    }

    // function that returns if the specified buffer has silence of speech
    function isSilence(buffer_pcm) {
      // Get data byte size, allocate memory on Emscripten heap, and get pointer
      var nDataBytes = buffer_pcm.length * buffer_pcm.BYTES_PER_ELEMENT;
      var dataPtr = Module._malloc(nDataBytes);
      // Copy data to Emscripten heap (directly accessed from Module.HEAPU8)
      var dataHeap = new Uint8Array(
        Module.HEAPU8.buffer,
        dataPtr,
        nDataBytes
      );
      dataHeap.set(new Uint8Array(buffer_pcm.buffer));
      // Call function and get result
      var result = webrtc_process_data(
        dataHeap.byteOffset,
        buffer_pcm.length,
        48000,
        buffer_pcm[0],
        buffer_pcm[100],
        buffer_pcm[2000]
      );
      // Free memory
      Module._free(dataHeap.byteOffset);
      return result;
    }

    function floatTo16BitPCM(output, input) {
      for (var i = 0; i < input.length; i++) {
        var s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }

    function onAudioProcessingEvent(e) {
      var buffer_pcm = new Int16Array(
        e.inputBuffer.getChannelData(0).length
      );
      floatTo16BitPCM(
        buffer_pcm,
        e.inputBuffer.getChannelData(0)
      );
      // algorithm used to determine if the user stopped speaking or not
      for (
        var i = 0;
        i < Math.ceil(buffer_pcm.length / sizeBufferVad) && !done;
        i++
      ) {
        var start = i * sizeBufferVad;
        var end = start + sizeBufferVad;
        if (start + sizeBufferVad > buffer_pcm.length) {
          // store to the next buffer
          buffer_vad.set(buffer_pcm.slice(start));
          leftovers = buffer_pcm.length - start;
        } else {
          if (leftovers > 0) {
            // we have this.leftovers from previous array
            end = end - this.leftovers;
            buffer_vad.set(
              buffer_pcm.slice(start, end),
              leftovers
            );
            leftovers = 0;
          } else {
            // send to the vad
            buffer_vad.set(buffer_pcm.slice(start, end));
          }
          var vad = isSilence(buffer_vad);
          buffer_vad = new Int16Array(sizeBufferVad);
          var dtdepois = Date.now();
          if (vad === 0) {
            if (touchedvoice) {
              samplessilence +=
                dtdepois - dtantesmili;
              if (samplessilence > maxsilence) {
                touchedsilence = true;
              }
            }
          } else {
            samplesvoice += dtdepois - dtantesmili;
            if (samplesvoice > minvoice) {
              touchedvoice = true;
            }
          }
          dtantesmili = dtdepois;
          if (touchedvoice && touchedsilence) {
            finishedvoice = true;
          }
          if (finishedvoice) {
            done = true;
            onComplete("finishedvoice");
          }
          if ((dtdepois - dtantes) / 1000 > maxtime) {
            done = true;
            if (touchedvoice) {
              onComplete("timeout");
            } else {
              onComplete("novoice");
              raisenovoice = true;
            }
          }
        }
      }
    }

    // Replaced by consumer
    function onCompleteCallback() {
      console.warn('SpeakToMe_VAD: You need to set an onComplete callback via setOnComplete(yourfunc)');
    }

    function setOnComplete(cb) {
      onCompleteCallback = cb;
    }

    function onComplete(why) {
      // TODO: fix this whole situ
      try {
        onCompleteCallback(why);
      } catch(ex) {
        console.log('SpeakToMe_VAD: onCompleteCallback exception', ex);
      }

      // Auto-reset for next input
      reset();
    }

    // TODO: something not initializing right - this shouldn't be necessary
    reset();

    // Public
    return {
      reset: reset,
      onAudioProcessingEvent: onAudioProcessingEvent,
      setOnComplete: setOnComplete
    };
  }

  return {
    SpeakToMeVAD: SpeakToMeVAD
  };
})();


// TODO modularize and protect the emscripten stuff
// because it seems to depend on window globals being exposed.
//
// Also, maybe just put this and webrtc_vad.js all in one file...

// Creation of the configuration object
// that will be pick by emscripten module
var Module = {
  preRun: [],
  postRun: [],
  print: (function() {
    return function(text) {
      console.log("[webrtc_vad.js print]", text);
    };
  })(),
  printErr: function(text) {
    console.error("[webrtc_vad.js error]", text);
  },
  canvas: (function() {})(),
  setStatus: function(text) {
    console.log("[webrtc_vad.js status] ", text);
  },
  totalDependencies: 0,
  monitorRunDependencies: function(left) {
    this.totalDependencies = Math.max(this.totalDependencies, left);
    Module.setStatus(
      left
      ? "Preparing... (" +
      (this.totalDependencies - left) +
      "/" +
      this.totalDependencies +
      ")"
      : "All downloads complete."
    );
  }
};

Module.setStatus("Loading webrtc_vad...");
window.onerror = function(event) {
  // TODO: do not warn on ok events like simulating an infinite loop or exitStatus
  Module.setStatus("Exception thrown, see JavaScript console");
  Module.setStatus = function(text) {
    if (text) {
      Module.printErr("[post-exception status] " + text);
    }
  };
};
Module.noInitialRun = true;
Module["onRuntimeInitialized"] = function() {
  Module.setStatus("Webrtc_vad and SpeakToMeVad loaded");
};

},{}]},{},[1,2])(2)
});