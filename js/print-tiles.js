/* Physical poster geometry and PDF assembly marks; no browser or build dependency. */
(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PrintTiles = api;
}(typeof window === 'undefined' ? this : window, function() {
    'use strict';
    var FORMATS = {a0: [841, 1189], a1: [594, 841], a2: [420, 594],
        a3: [297, 420], a4: [210, 297]};
    var OVERLAP = 15, MARGIN = 10;

    function layout(format, orientation, columns, rows) {
        if (!Object.prototype.hasOwnProperty.call(FORMATS, format) ||
                ['portrait', 'landscape'].indexOf(orientation) < 0) {
            throw new Error('Bitte DIN A0 bis DIN A4 und eine Ausrichtung auswählen.');
        }
        if (!Number.isInteger(columns) || !Number.isInteger(rows) ||
                columns < 1 || rows < 1 || columns > 10 || rows > 10) {
            throw new Error('Bitte für Spalten und Zeilen jeweils eine ganze Zahl von 1 bis 10 eingeben.');
        }
        var size = FORMATS[format], landscape = orientation === 'landscape';
        var width = size[landscape ? 1 : 0], height = size[landscape ? 0 : 1];
        var imageWidth = width - 2 * MARGIN, imageHeight = height - 2 * MARGIN;
        var stepX = imageWidth - OVERLAP, stepY = imageHeight - OVERLAP;
        var result = {format: format, orientation: orientation, columns: columns, rows: rows,
            pageWidth: width, pageHeight: height, imageWidth: imageWidth, imageHeight: imageHeight,
            width: imageWidth + (columns - 1) * stepX,
            height: imageHeight + (rows - 1) * stepY,
            margin: MARGIN, overlap: OVERLAP, pages: []};
        for (var row = 0; row < rows; row++) {
            for (var column = 0; column < columns; column++) {
                result.pages.push({row: row, column: column, x: column * stepX, y: row * stepY,
                    number: row * columns + column + 1, label: 'Z' + (row + 1) + '-S' + (column + 1)});
            }
        }
        return result;
    }

    // One Mercator camera for the entire poster. Recomputing the zoom at each
    // sheet's latitude would change scale and prevent the overlaps from matching.
    function offsetCenter(center, zoom, bearing, dxMm, dyMm) {
        var worldSize = 512 * Math.pow(2, zoom), radians = bearing * Math.PI / 180;
        var dx = dxMm * 96 / 25.4, dy = dyMm * 96 / 25.4;
        var x = (center.lng + 180) / 360 + (Math.cos(radians) * dx - Math.sin(radians) * dy) / worldSize;
        var latitude = center.lat * Math.PI / 180;
        var y = (1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI) / 2 +
            (Math.sin(radians) * dx + Math.cos(radians) * dy) / worldSize;
        if (y < 0 || y > 1 || !Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error('Das Blattraster überschreitet den Mercator-Kartenbereich. Bitte Ort oder Maßstab ändern.');
        }
        return {lng: x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI};
    }

    function pageCenter(poster, page, center, zoom, bearing) {
        return offsetCenter(center, zoom, bearing,
            page.x + poster.imageWidth / 2 - poster.width / 2,
            page.y + poster.imageHeight / 2 - poster.height / 2);
    }

    function drawMarks(pdf, poster, page, attribution) {
        var m = poster.margin, w = poster.pageWidth, h = poster.pageHeight;
        var right = w - m, bottom = h - m, half = poster.overlap / 2;
        pdf.setDrawColor(40, 40, 40);
        pdf.setTextColor(40, 40, 40);
        pdf.setLineWidth(0.2);
        // Crop ticks stop outside the map; printer-safe positions start at 5 mm.
        [m, right].forEach(function(x) {
            pdf.line(x, 5, x, m - 1);
            pdf.line(x, bottom + 1, x, h - 5);
        });
        [m, bottom].forEach(function(y) {
            pdf.line(5, y, m - 1, y);
            pdf.line(right + 1, y, w - 5, y);
        });
        function cross(x, y) {
            pdf.line(x - 1.5, y, x + 1.5, y);
            pdf.line(x, y - 1.5, x, y + 1.5);
        }
        // Corresponding crosses refer to identical positions in each duplicated
        // 15 mm strip. Keep them in removable margins, outside the finished map.
        if (page.column > 0) { cross(m + half, 7); cross(m + half, h - 7); }
        if (page.column < poster.columns - 1) { cross(right - half, 7); cross(right - half, h - 7); }
        if (page.row > 0) { cross(7, m + half); cross(w - 7, m + half); }
        if (page.row < poster.rows - 1) { cross(7, bottom - half); cross(w - 7, bottom - half); }
        pdf.setFontSize(7);
        var title = 'Blatt ' + page.number + '/' + poster.pages.length + ' | ' + page.label +
            ' | ' + poster.format.toUpperCase() + ' | 15 mm Ueberlappung | 100 % drucken';
        pdf.text(title, w / 2, 7.5, null, null, 'center');
        var neighbours = [];
        if (page.column > 0) neighbours.push('links: Z' + (page.row + 1) + '-S' + page.column);
        if (page.column < poster.columns - 1) neighbours.push('rechts: Z' + (page.row + 1) + '-S' + (page.column + 2));
        if (page.row > 0) neighbours.push('oben: Z' + page.row + '-S' + (page.column + 1));
        if (page.row < poster.rows - 1) neighbours.push('unten: Z' + (page.row + 2) + '-S' + (page.column + 1));
        pdf.setFontSize(6);
        pdf.text(neighbours.length ? neighbours.join(' | ') : 'Einzelblatt', w / 2, h - 8, null, null, 'center');
        pdf.text('Innen links/oben am Bildrand schneiden. 15 mm ueberlappen; Passkreuze ausrichten. | ' + attribution,
            w / 2, h - 5.3, null, null, 'center');
        // Repeat attribution in each sheet's footer; retain one copy on the
        // assembled map without obscuring any shared strip at an interior join.
        if (page.number !== poster.pages.length) return;
        pdf.setFontSize(6);
        var textWidth = pdf.getStringUnitWidth(attribution) * 6 / pdf.internal.scaleFactor;
        pdf.setFillColor(255, 255, 255);
        pdf.rect(right - textWidth - 3, bottom - 4.5, textWidth + 3, 4.5, 'F');
        pdf.text(attribution, right - 1, bottom - 1.3, null, null, 'right');
    }

    return {FORMATS: FORMATS, layout: layout, offsetCenter: offsetCenter,
        pageCenter: pageCenter, drawMarks: drawMarks};
}));
