document.getElementById('audio-upload').addEventListener('change', handleAudioUpload);
document.getElementById('chop').addEventListener('click', chopAudio);
document.getElementById('play').addEventListener('click', playModifiedAudio);
document.getElementById('download').addEventListener('click', downloadModifiedAudio);

let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let audioBuffer;
let modifiedBuffer;
let source;
let startTime;
let animationFrameId;

function handleAudioUpload(event) {
    let file = event.target.files[0];
    let reader = new FileReader();
    reader.onload = function(e) {
        audioContext.decodeAudioData(e.target.result, function(buffer) {
            audioBuffer = buffer;
            visualizeWaveform(buffer);
        });
    };
    reader.readAsArrayBuffer(file);
}

function visualizeWaveform(buffer) {
    let canvas = document.getElementById('waveform');
    let canvasCtx = canvas.getContext('2d');
    canvas.style.display = 'block';
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    let data = buffer.getChannelData(0);
    let step = Math.ceil(data.length / canvas.width);
    let amp = canvas.height / 2;
    canvasCtx.fillStyle = 'white';
    for (let i = 0; i < canvas.width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
            let datum = data[(i * step) + j]; 
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        canvasCtx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
}

function drawPlayhead() {
    let canvas = document.getElementById('waveform');
    let canvasCtx = canvas.getContext('2d');
    let currentTime = audioContext.currentTime - startTime;
    let position = (currentTime / modifiedBuffer.duration) * canvas.width;

    // Clear the previous playhead
    visualizeWaveform(modifiedBuffer);

    // Draw the new playhead
    canvasCtx.strokeStyle = 'red';
    canvasCtx.beginPath();
    canvasCtx.moveTo(position, 0);
    canvasCtx.lineTo(position, canvas.height);
    canvasCtx.stroke();

    if (currentTime < modifiedBuffer.duration) {
        animationFrameId = requestAnimationFrame(drawPlayhead);
    }
}

function chopAudio() {
    let bpm = parseInt(document.getElementById('bpm').value);
    if (!bpm || bpm <= 0) {
        alert('Please enter a valid BPM.');
        return;
    }

    let chopSize = document.getElementById('chop-size').value;
    let noteFraction;
    switch (chopSize) {
        case '1/4':
            noteFraction = 1/4;
            break;
        case '1/3':
            noteFraction = 1/3;
            break;
        case '1/2':
            noteFraction = 1/2;
            break;
        case '1':
            noteFraction = 1;
            break;
        case '2':
            noteFraction = 2;
            break;
        default:
            noteFraction = 1/4;
            
    }

    let noteDuration = 60 / bpm * noteFraction; // Duration of the note in seconds
    let sliceLength = Math.floor(noteDuration * audioBuffer.sampleRate); // Convert to sample length

    let slices = [];
    for (let i = 0; i < audioBuffer.length; i += sliceLength) {
        let slice = createSlice(audioBuffer, i, sliceLength);
        if (isSignificantSlice(slice)) {
            slices.push(slice);
        }
    }

    // Shuffle and repeat some slices
    let shuffledSlices = [];
    while (shuffledSlices.length * sliceLength < audioBuffer.length) {
        let slice = slices[Math.floor(Math.random() * slices.length)];
        shuffledSlices.push(slice);
    }

    mergeSlices(shuffledSlices);
    alert('Chopped and rearranged the audio');
    document.getElementById('play').disabled = false;
    document.getElementById('download').disabled = false;
    visualizeWaveform(modifiedBuffer); // Display waveform of the modified audio
}

function createSlice(buffer, start, length) {
    let slice = audioContext.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        let inputData = buffer.getChannelData(channel);
        let outputData = slice.getChannelData(channel);
        for (let i = 0; i < length && (start + i) < buffer.length; i++) {
            outputData[i] = inputData[start + i];
        }
    }
    return slice;
}

function isSignificantSlice(slice) {
    let threshold = 0.01; // Threshold to consider a slice significant
    let rms = 0;
    for (let channel = 0; channel < slice.numberOfChannels; channel++) {
        let data = slice.getChannelData(channel);
        let sum = data.reduce((acc, sample) => acc + sample * sample, 0);
        rms += Math.sqrt(sum / data.length);
    }
    rms /= slice.numberOfChannels;
    return rms > threshold;
}

function mergeSlices(slices) {
    let length = slices.reduce((total, slice) => total + slice.length, 0);
    modifiedBuffer = audioContext.createBuffer(audioBuffer.numberOfChannels, length, audioBuffer.sampleRate);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        let outputData = modifiedBuffer.getChannelData(channel);
        let offset = 0;
        slices.forEach(slice => {
            let inputData = slice.getChannelData(channel);
            outputData.set(inputData, offset);

            // Apply fade-in and fade-out
            let fadeDuration = 0.005; // 5ms fade duration
            let fadeSampleCount = Math.floor(fadeDuration * audioBuffer.sampleRate);
            for (let i = 0; i < fadeSampleCount; i++) {
                outputData[offset + i] *= i / fadeSampleCount;
                outputData[offset + slice.length - 1 - i] *= i / fadeSampleCount;
            }

            offset += slice.length;
        });
    }
}

function playModifiedAudio() {
    if (source) source.stop();
    source = audioContext.createBufferSource();
    source.buffer = modifiedBuffer;

    let gainNode = audioContext.createGain();
    gainNode.gain.value = document.getElementById('effect-reverb').value;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    source.start();
    startTime = audioContext.currentTime;
    animationFrameId = requestAnimationFrame(drawPlayhead);
}

function downloadModifiedAudio() {
    let offlineContext = new OfflineAudioContext(modifiedBuffer.numberOfChannels, modifiedBuffer.length, modifiedBuffer.sampleRate);
    let bufferSource = offlineContext.createBufferSource();
    bufferSource.buffer = modifiedBuffer;
    bufferSource.connect(offlineContext.destination);
    bufferSource.start();
    offlineContext.startRendering().then(renderedBuffer => {
        let audioBlob = bufferToWave(renderedBuffer, renderedBuffer.length);
        let url = URL.createObjectURL(audioBlob);
        let link = document.createElement('a');
        link.href = url;
        link.download = 'modified-audio.wav';
        link.click();
    });
}

function bufferToWave(buffer, len) {
    let numOfChan = buffer.numberOfChannels,
        length = buffer.length * numOfChan * 2 + 44,
        bufferArray = new ArrayBuffer(length),
        view = new DataView(bufferArray),
        channels = [],
        i,
        sample,
        offset = 0,
        pos = 0;

    // Write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    // Write format chunk
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this example)

    // Write data chunk
    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // Interleave channels
    for (i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

    while (pos < length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            sample = (0.5 + sample * 32767) | 0; // scale to 16-bit signed int
            view.setInt16(pos, sample, true); // write 16-bit sample
            pos += 2;
        }
        offset++; // next source sample
    }

    return new Blob([bufferArray], { type: 'audio/wav' });

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}
