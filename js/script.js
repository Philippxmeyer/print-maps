/*
 * Print Maps - High-resolution maps in the browser, for printing
 * Copyright (c) 2015-2020 Matthew Petroff
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
 
mapboxgl.accessToken = 'pk.eyJ1IjoicGhpbGlwcHhtZXllciIsImEiOiJjbXczNjN0dDEwNjZqMzBzY21mOGJtYnViIn0.Wljtk31uTsLsSjhXWlBYzQ';

var form = document.getElementById('config');
var map, scaleController, previewBar;
var exporting = false;
var scaleInputDirty = false;
var maxSize = 4096;
var errors = {
    width: {state: false, grp: 'widthGroup'},
    height: {state: false, grp: 'heightGroup'},
    dpi: {state: false, grp: 'dpiGroup'},
    scale: {state: false, grp: 'scaleGroup'},
    latitude: {state: false, grp: 'latGroup'},
    longitude: {state: false, grp: 'lonGroup'}
};

if (!mapboxgl.accessToken || mapboxgl.accessToken.length < 10) {
    for (var i = form.styleSelect.length - 1; i >= 0; i--) {
        if (form.styleSelect[i].value.indexOf('mapbox') >= 0) form.styleSelect.remove(i);
    }
}

function updateAttribution() {
    var isMapbox = form.styleSelect.value.indexOf('mapbox') >= 0;
    document.getElementById('mapbox-attribution').style.display = isMapbox ? 'block' : 'none';
    document.getElementById('stadiamaps-attribution').style.display = isMapbox ? 'none' : 'block';
}
updateAttribution();

function updateLocationInputs() {
    var center = map.getCenter();
    form.zoomInput.value = map.getZoom().toFixed(3);
    // Rounded display values never feed back into the camera or scale maths.
    if (document.activeElement !== form.latInput) form.latInput.value = center.lat.toFixed(4);
    if (document.activeElement !== form.lonInput) form.lonInput.value = center.lng.toFixed(4);
}

function scaleChanged(state) {
    updateLocationInputs();
    if (state.reason === 'initialize' || state.reason === 'userZoom') {
        form.scaleInput.value = Number(state.target.toFixed(state.target < 10 ? 2 : 0));
        scaleInputDirty = false;
    }
    form.scalePreset.value = ['5000', '10000', '25000', '50000', '100000'].filter(function(n) {
        return Math.abs(Number(n) / state.target - 1) < 1e-10;
    })[0] || '';
    errors.scale.state = !state.valid || !PrintScale.positive(Number(form.scaleInput.value));
    errors.scale.msg = 'Dieser Maßstab liegt am Kartenmittelpunkt außerhalb der Zoomgrenzen (' +
        map.getMinZoom() + ' bis ' + map.getMaxZoom() + '). Bitte Maßstab oder Ort ändern.';
    document.getElementById('scale-status').textContent = state.valid ? '' :
        'Angeforderter Maßstab nicht erreichbar. Tatsächlicher Maßstab: 1 : ' +
        PrintScale.formatScale(state.actual) + '. Leiste und Export sind deaktiviert.';
    handleErrors();
    drawPreviewBar();
}

try {
    map = new mapboxgl.Map({
        container: 'map', center: [0, 0], zoom: 0.5, pitch: 0,
        pitchWithRotate: false, touchPitch: false, style: form.styleSelect.value
    });
    if (map.touchPitch) map.touchPitch.disable();
    map.addControl(new mapboxgl.NavigationControl());
    scaleController = new PrintScale.Controller(map, scaleChanged);
    previewBar = document.createElement('canvas');
    previewBar.className = 'print-scale-overlay';
    previewBar.setAttribute('aria-hidden', 'true');
    map.getContainer().appendChild(previewBar);
    var gl = map.getCanvas().getContext('webgl') || map.getCanvas().getContext('experimental-webgl');
    maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
    map.on('resize', drawPreviewBar);
    if (map.loaded()) scaleController.initialize();
} catch (e) {
    document.getElementById('config-fields').disabled = true;
    document.getElementById('generate-btn').disabled = true;
    openErrorModal('This site requires WebGL: ' + e.message);
}

if (map && 'geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(function(position) {
        function locate() {
            // An immediate center-only move retains the chosen print scale.
            map.jumpTo({center: [position.coords.longitude, position.coords.latitude], pitch: 0});
        }
        if (scaleController.target !== null) locate();
        else map.once('load', locate);
    }, function() { /* Permission is optional; retain the current view. */ });
}

function handleErrors() {
    var messages = [];
    Object.keys(errors).forEach(function(key) {
        var error = errors[key];
        document.getElementById(error.grp).classList.toggle('has-error', error.state);
        if (error.state) messages.push(error.msg);
    });
    var element = document.getElementById('error-message');
    element.textContent = messages.join(' ');
    element.style.display = messages.length ? 'block' : 'none';
    document.getElementById('generate-btn').disabled = exporting || messages.length > 0 ||
        !scaleController || scaleController.target === null;
}
function isError() {
    return Object.keys(errors).some(function(key) { return errors[key].state; });
}
function unit() { return form.unitOptions[0].checked ? 'in' : 'mm'; }
function inches(value) { return unit() === 'mm' ? value / 25.4 : value; }
function toPixels(length) { return inches(length) * PrintScale.CSS_DPI + 'px'; }

function validateDimensions() {
    var dpi = Number(form.dpiInput.value);
    errors.dpi.state = !PrintScale.positive(dpi);
    errors.dpi.msg = 'DPI must be a finite positive number!';
    ['width', 'height'].forEach(function(name) {
        var value = inches(Number(form[name + 'Input'].value));
        var cssPixels = value * PrintScale.CSS_DPI;
        var pixels = value * dpi;
        var error = errors[name];
        error.state = !PrintScale.positive(value) || cssPixels < 1 || !Number.isFinite(pixels) ||
            pixels < 1 || pixels > maxSize || cssPixels * window.devicePixelRatio > maxSize;
        error.msg = name + ': Bitte ein positives Papiermaß mit mindestens einem Vorschau-/Exportpixel ' +
            'und höchstens ' + maxSize + ' Pixeln pro Seite wählen.';
        if (!error.state && map) map.getContainer().style[name] = cssPixels + 'px';
    });
    // Avoid a predictable allocation failure, particularly on small devices.
    if (!errors.width.state && !errors.height.state &&
            inches(Number(form.widthInput.value)) * inches(Number(form.heightInput.value)) * dpi * dpi > 64000000) {
        errors.dpi.state = true;
        errors.dpi.msg = 'Export zu groß (maximal 64 Megapixel). Bitte DPI oder Papiermaß verringern.';
    }
    if (map && !errors.width.state && !errors.height.state) map.resize();
    handleErrors();
    drawPreviewBar();
}
form.widthInput.addEventListener('change', validateDimensions);
form.heightInput.addEventListener('change', validateDimensions);
form.dpiInput.addEventListener('change', validateDimensions);
form.styleSelect.addEventListener('change', function() {
    try { map.setStyle(form.styleSelect.value); }
    catch (e) { openErrorModal('Error changing style: ' + e.message); }
    updateAttribution();
});
form.mmUnit.addEventListener('change', function() {
    form.widthInput.value = Number(form.widthInput.value) * 25.4;
    form.heightInput.value = Number(form.heightInput.value) * 25.4;
    validateDimensions();
});
form.inUnit.addEventListener('change', function() {
    form.widthInput.value = Number(form.widthInput.value) / 25.4;
    form.heightInput.value = Number(form.heightInput.value) / 25.4;
    validateDimensions();
});

function applyScale() {
    var value = Number(form.scaleInput.value);
    if (!PrintScale.positive(value)) {
        errors.scale.state = true;
        errors.scale.msg = 'Bitte einen endlichen, positiven Maßstabsnenner eingeben.';
        handleErrors();
        drawPreviewBar();
        return;
    }
    if (scaleInputDirty) {
        scaleInputDirty = false;
        scaleController.setTarget(value);
    }
}
form.scaleInput.addEventListener('input', function() {
    scaleInputDirty = true;
    errors.scale.state = !PrintScale.positive(Number(form.scaleInput.value));
    errors.scale.msg = 'Bitte einen endlichen, positiven Maßstabsnenner eingeben.';
    handleErrors();
    drawPreviewBar();
});
form.scaleInput.addEventListener('change', applyScale);
form.scalePreset.addEventListener('change', function() {
    if (!form.scalePreset.value) return;
    form.scaleInput.value = form.scalePreset.value;
    scaleInputDirty = true;
    applyScale();
});
form.scaleBarInput.addEventListener('change', drawPreviewBar);

function changeCoordinate(event) {
    var latChanged = event.target === form.latInput;
    var value = Number(event.target.value);
    var error = errors[latChanged ? 'latitude' : 'longitude'];
    error.state = event.target.value.trim() === '' || !Number.isFinite(value) ||
        (latChanged && Math.abs(value) > PrintScale.MAX_LATITUDE);
    error.msg = latChanged ? 'Latitude must be between -85.051129 and 85.051129 degrees.' :
        'Longitude must be a finite number.';
    if (!error.state) {
        var center = map.getCenter();
        map.jumpTo({center: latChanged ? [center.lng, value] : [value, center.lat], pitch: 0});
    }
    handleErrors();
}
form.latInput.addEventListener('change', changeCoordinate);
form.lonInput.addEventListener('change', changeCoordinate);

function drawPreviewBar() {
    if (!previewBar || !scaleController) return;
    var visible = form.scaleBarInput.checked && scaleController.valid && !errors.scale.state;
    previewBar.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    var container = map.getContainer();
    var ratio = window.devicePixelRatio;
    previewBar.width = Math.round(container.clientWidth * ratio);
    previewBar.height = Math.round(container.clientHeight * ratio);
    PrintScale.drawBar(previewBar.getContext('2d'), previewBar.width, previewBar.height,
        PrintScale.scaleFromZoom(map.getCenter().lat, map.getZoom()), PrintScale.CSS_DPI * ratio);
}

var origBodyPaddingRight;
function openErrorModal(msg) {
    var modal = document.getElementById('errorModal');
    document.getElementById('modal-error-text').textContent = msg;
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
    document.getElementById('modalBackdrop').style.height = modal.scrollHeight + 'px';
    document.getElementById('modalBackdrop').style.display = 'block';
    if (document.body.scrollHeight > document.documentElement.clientHeight) {
        origBodyPaddingRight = document.body.style.paddingRight;
        var padding = parseInt((document.body.style.paddingRight || 0), 10);
        document.body.style.paddingRight = padding + measureScrollbar() + 'px';
    }
}
function closeErrorModal() {
    document.getElementById('errorModal').style.display = 'none';
    document.getElementById('modalBackdrop').style.display = 'none';
    document.body.classList.remove('modal-open');
    document.body.style.paddingRight = origBodyPaddingRight;
}
function measureScrollbar() {
    var scrollDiv = document.createElement('div');
    scrollDiv.className = 'modal-scrollbar-measure';
    document.body.appendChild(scrollDiv);
    var width = scrollDiv.offsetWidth - scrollDiv.clientWidth;
    scrollDiv.parentNode.removeChild(scrollDiv);
    return width;
}

// High-resolution rendering: snapshot the camera, then composite on a separate
// 2D canvas. Both output formats use exactly this composited image.
document.getElementById('generate-btn').addEventListener('click', generateMap);
function generateMap() {
    if (exporting || !map || !scaleController || scaleController.target === null) return;
    applyScale();
    validateDimensions();
    map.stop();
    scaleController.update(); // Flush the scale correction before taking a snapshot.
    if (isError()) {
        openErrorModal('The current configuration is invalid! Please correct the errors and try again.');
        return;
    }
    var settings = {
        width: Number(form.widthInput.value), height: Number(form.heightInput.value),
        dpi: Number(form.dpiInput.value), unit: unit(),
        format: form.outputOptions[0].checked ? 'png' : 'pdf',
        style: form.styleSelect.value, bar: form.scaleBarInput.checked,
        center: {lng: map.getCenter().lng, lat: map.getCenter().lat},
        scale: scaleController.target, bearing: map.getBearing(),
        minZoom: map.getMinZoom(), maxZoom: map.getMaxZoom()
    };
    exporting = true;
    form.querySelector('fieldset').disabled = true;
    map.getContainer().classList.add('exporting');
    document.getElementById('spinner').style.display = 'inline-block';
    handleErrors();
    return createPrintMap(settings).catch(function(error) {
        openErrorModal('Export fehlgeschlagen: ' + error.message);
    }).finally(function() {
        exporting = false;
        form.querySelector('fieldset').disabled = false;
        map.getContainer().classList.remove('exporting');
        document.getElementById('spinner').style.display = 'none';
        handleErrors();
        drawPreviewBar();
    });
}

function createPrintMap(settings) {
    return new Promise(function(resolve, reject) {
        var descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
        var renderMap, hidden, timeout, finished = false;
        function finish(error) {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            try {
                if (renderMap) renderMap.remove();
            } catch (cleanupError) { error = error || cleanupError; }
            finally {
                if (hidden && hidden.parentNode) hidden.parentNode.removeChild(hidden);
                if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor);
                else delete window.devicePixelRatio;
            }
            if (error) reject(error); else resolve();
        }
        try {
            var widthIn = settings.unit === 'mm' ? settings.width / 25.4 : settings.width;
            var heightIn = settings.unit === 'mm' ? settings.height / 25.4 : settings.height;
            Object.defineProperty(window, 'devicePixelRatio', {
                configurable: true, get: function() { return settings.dpi / PrintScale.CSS_DPI; }
            });
            hidden = document.createElement('div');
            hidden.className = 'hidden-map';
            document.body.appendChild(hidden);
            var container = document.createElement('div');
            container.style.width = widthIn * PrintScale.CSS_DPI + 'px';
            container.style.height = heightIn * PrintScale.CSS_DPI + 'px';
            hidden.appendChild(container);
            var zoom = PrintScale.zoomFromScale(settings.center.lat, settings.scale);
            // Account for the integer CSS viewport used by Mapbox. The output
            // bitmap itself is rounded to the requested paper size and DPI.
            zoom += Math.log2(container.clientWidth / (widthIn * PrintScale.CSS_DPI));
            if (zoom < settings.minZoom || zoom > settings.maxZoom) {
                throw new Error('Maßstab liegt für dieses Papierformat an einer Zoomgrenze.');
            }
            renderMap = new mapboxgl.Map({
                container: container, center: settings.center, zoom: zoom,
                minZoom: settings.minZoom, maxZoom: settings.maxZoom,
                style: settings.style, bearing: settings.bearing, pitch: 0,
                interactive: false, preserveDrawingBuffer: true,
                fadeDuration: 0, attributionControl: false
            });
            timeout = setTimeout(function() { finish(new Error('Zeitüberschreitung beim Kartenrendering.')); }, 45000);
            renderMap.on('error', function(event) { finish(event.error || new Error('Kartenressource nicht verfügbar.')); });
            renderMap.once('idle', function() {
                if (finished) return;
                try {
                    var output = document.createElement('canvas');
                    output.width = Math.round(widthIn * settings.dpi);
                    output.height = Math.round(heightIn * settings.dpi);
                    var context = output.getContext('2d');
                    if (!context) throw new Error('2D-Canvas konnte nicht erstellt werden.');
                    context.drawImage(renderMap.getCanvas(), 0, 0, output.width, output.height);
                    var center = renderMap.getCenter();
                    var actualScale = PrintScale.scaleFromZoom(center.lat, renderMap.getZoom()) *
                        container.clientWidth / (widthIn * PrintScale.CSS_DPI);
                    if (Math.abs(actualScale / settings.scale - 1) > 1e-6) {
                        throw new Error('Die Exportkamera kann den angeforderten Maßstab nicht darstellen.');
                    }
                    if (settings.bar) PrintScale.drawBar(context, output.width, output.height,
                        actualScale, settings.dpi);
                    if (settings.format === 'png') {
                        output.toBlob(function(blob) {
                            if (finished) return;
                            try {
                                if (!blob) throw new Error('PNG konnte nicht erstellt werden.');
                                saveAs(blob, 'map.png');
                                finish();
                            } catch (error) { finish(error); }
                        }, 'image/png');
                    } else {
                        var pdf = new jsPDF({orientation: settings.width > settings.height ? 'l' : 'p',
                            unit: settings.unit, format: [settings.width, settings.height], compress: true});
                        pdf.addImage(output.toDataURL('image/png'), 'png', 0, 0,
                            settings.width, settings.height, null, 'FAST');
                        pdf.setProperties({
                            title: renderMap.getStyle().name || 'Print Maps',
                            subject: 'center: [' + center.lng + ', ' + center.lat + ', ' + renderMap.getZoom() +
                                '], local scale 1:' + actualScale,
                            creator: 'Print Maps',
                            author: '(c) ' + (settings.style.indexOf('mapbox') >= 0 ? 'Mapbox' : 'Stadia Maps') +
                                ', (c) OpenStreetMap'
                        });
                        pdf.save('map.pdf');
                        finish();
                    }
                } catch (error) { finish(error); }
            });
        } catch (error) { finish(error); }
    });
}
handleErrors();
