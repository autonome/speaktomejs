## speaktome-js-component

<!--
[![Version](http://img.shields.io/npm/v/speaktomejs.svg?style=flat-square)](https://npmjs.org/package/speaktomejs)
[![License](http://img.shields.io/npm/l/speaktomejs.svg?style=flat-square)](https://npmjs.org/package/speaktomejs)
-->

JavaScript module for Mozilla&#39;s SpeakToMe API.

<!--
### API

| Property | Description | Default Value |
| -------- | ----------- | ------------- |
|          |             |               |

-->

### Installation

#### Browser

Install and use by directly including the [browser files](dist):

```html
<head>
  <title>My Speech-enabled Web Page</title>
  <script src="stm.min.js"></script>
  <script src="webrtc_vad.js"></script>
</head>

<body>
<script>
var stm = SpeakToMe({
  listener: listener
});

function listener(msg) {
	console.log('listener', msg);---------------------------------------------------------------------
}
</script>
</body>
```

<!--
Install and use by directly including the [browser files](dist):

```html
<head>
  <title>My Speech-enabled Web Page</title>
  <script src="https://aframe.io/releases/0.6.0/aframe.min.js"></script>
  <script src="https://unpkg.com/speaktomejs/dist/speaktomejs.min.js"></script>
</head>

<body>
  <a-scene>
    <a-entity speaktome="foo: bar"></a-entity>
  </a-scene>
</body>
```

#### npm

Install via npm:

```bash
npm install speaktomejs
```

Then require and use.

```js
require('speaktomejs');
```
-->
