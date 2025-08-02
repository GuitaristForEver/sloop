/*
 * Copyright (c) 2019, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

const palette = {
    baseDark: ["#1a1d29", "#252836", "#2d3142", "#3c4043"],
    baseLight: ["#e8eaed", "#9aa0a6", "#5f6368", "#3c4043"],
    primary: ["#4285f4", "#34a853", "#fbbc04", "#ea4335"],
    highlight: ["#4285f4", "#34a853", "#fbbc04", "#ea4335", "#9c27b0", "#ff5722", "#795548", "#607d8b",
        "#e91e63", "#3f51b5", "#2196f3", "#00bcd4", "#009688", "#4caf50", "#8bc34a", "#cddc39"],
    severity: ['#34a853', '#fbbc04', '#ea4335'],
};

// Enhanced color schemes for better accessibility
const colorSchemes = {
    default: palette,
    highContrast: {
        ...palette,
        highlight: ["#ffffff", "#ffff00", "#ff00ff", "#00ffff", "#ff0000", "#00ff00", "#0000ff", "#ffa500"],
        severity: ['#00ff00', '#ffff00', '#ff0000']
    }
};

let currentColorScheme = colorSchemes.default;

// Globals Live Here
let topAxis, bottomAxis;

// These functions get called whenever the properties of either axis are changed
let topAxisDrawFunc, bottomAxisDrawFunc;

// These are d3 structs
let xAxisScale, yAxisBand;

// Array containing data retrieved from sloop server
let data;

// The time displayed on certain mouseover and mousemove events
let theTime;

// These define the maximum drawing space on the window. I don't think
// this is the correct way of using these vars - it doesn't really respect window resizing
// and weird minimums and display scaling could potentially cause problems.
let displayMaxX, displayMaxY;

// Vertical spacing between bars
const resourceBarVerticalSpacing = 0.2;

// svg reference for rendering svg using d3
let svg;

// Since we're drawing bars on bars within the same yAxisBandwidth -
// This margin defines the space between the resource bar - and it's containing
// band within in the yAxisBand
let smallBarMargin;

let margin = {
    top: 20,
    left: 100
};

// Enhanced responsive design
let isMobile = window.innerWidth <= 768;

window.onresize = loadSVG;

function initializeDimensions() {
    displayMaxX = document.documentElement.clientWidth;
    displayMaxY = document.documentElement.clientHeight;
    isMobile = window.innerWidth <= 768;
    margin.left = isMobile ? 60 : 100;
}

detailedToolTipIsVisible = false;

let noSortFn = function () {
    return 0
};

const compareStartFn = function (a, b) {
    if (a.kind != b.kind) {
        return compareKind(a, b)
    }
    return a.start - b.start;
};
const compareMostEventsFn = function (a, b) {
    if (a.kind != b.kind) {
        return compareKind(a, b)
    }
    return b.overlays.length - a.overlays.length;
};
const compareNameFn = function (a, b) {
    if (a.kind != b.kind) {
        return compareKind(a, b)
    }
    return ('' + a.text).localeCompare(b.text);
};
let cmpFn = noSortFn;

function loadSVG() {
    showLoadingState();
    payload = d3.json(dataQueryUrl);
    payload.then(function (result) {
        initializeDimensions();
        svg = render(result);
        bindMouseEvents(svg);
        appendAxes(svg);
        renderTooltip();
        hideLoadingState();
        addEnhancedInteractions();
    }).catch(function(error) {
        console.error('Error loading data:', error);
        hideLoadingState();
        showErrorState();
    });
}

function showLoadingState() {
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
}

function hideLoadingState() {
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) loadingIndicator.style.display = 'none';
}

function showErrorState() {
    const container = document.getElementById('d3_here');
    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column;">
            <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
            <h3 style="color: var(--accent-red); margin-bottom: 8px;">Failed to Load Data</h3>
            <p style="color: var(--text-secondary); text-align: center;">
                Unable to fetch visualization data. Please check your connection and try again.
            </p>
            <button onclick="loadSVG()" style="margin-top: 16px; padding: 8px 16px; background: var(--accent-blue); color: white; border: none; border-radius: 4px; cursor: pointer;">
                Retry
            </button>
        </div>
    `;
}

loadSVG();

// Payload toggle switch on change to display payload change ticks
function payloadChecker() {
    if(document.getElementById("payloadCheck").checked == true) {
        Array.from(document.getElementsByClassName("payloadChange"))
            .map(e => e.style.display = "block");
    } else {
        Array.from(document.getElementsByClassName("payloadChange"))
             .map(e => e.style.display = "none");
    }
}

//  Display different query methods based on radio value
function queryChange(radio) {
    if (radio.value === "regex") {
        Array.from(document.getElementsByClassName("regex"))
            .map(e => e.style.display = "block");
        Array.from(document.getElementsByClassName("partition"))
            .map(e => e.style.display = "none");
    }
    if (radio.value === "partition") {
        Array.from(document.getElementsByClassName("regex"))
            .map(e => e.style.display = "none");
        Array.from(document.getElementsByClassName("partition"))
            .map(e => e.style.display = "block");
    }
}

function render(result) {
    let data = processAndSortResources(result);
    let dataByKind, kinds, filteredData;

    if (!data) {
        xAxisScale = d3.scaleUtc().range([margin.left, displayMaxX - margin.left]);
        yAxisBand = d3.scaleBand().padding(resourceBarVerticalSpacing);

        topAxisDrawFunc = d3.axisTop(xAxisScale);
        bottomAxisDrawFunc = d3.axisBottom(xAxisScale);
        filteredData = []
    } else {
        dataByKind = d3.nest().key(d => d.kind).entries(data);
        kinds = dataByKind.map(d => d.key);

        barColorGenFunc = d3.scaleOrdinal().domain(kinds).range(currentColorScheme.highlight);
        severityColorGenFunc = d3.scaleLinear().domain([0, 1, 2]).range(currentColorScheme.severity);

        xAxisScale = d3.scaleUtc()
            .domain([d3.min(data, d => d.start), d3.max(data, d => d.end)])
            .range([margin.left, displayMaxX - margin.left]);

        yAxisBand = d3.scaleBand()
            .domain(d3.range(data.length))
            .range([margin.top, (data.length * (isMobile ? 25 : 30)) - margin.top])
            .padding(resourceBarVerticalSpacing);

        smallBarMargin = 0.1 * yAxisBand.bandwidth();


        filteredData = [].concat.apply([], dataByKind.map(d => d.values));
        filteredData.forEach(d => d.color = d3.color(barColorGenFunc(d.kind)));
    }

    topAxisDrawFunc = d3.axisTop(xAxisScale);
    bottomAxisDrawFunc = d3.axisBottom(xAxisScale);

    let svgWidth = xAxisScale.range()[1] + (2 * margin.left);
    let svgHeight = yAxisBand.range()[1] + (2 * margin.top);

    // remove existing svg references and recreate it. 
    if(svg) {
        svg = d3.select("#d3_here .svg-container, #d3_here");
        svg.selectAll('*').remove();
    }
    svg = d3.select("#d3_here")
        .append("svg")
        .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
        .classed("svg-content", true);

    g = svg.append("g");
    // Create the graphical representation of each resource
    groups = g
        .selectAll("g")
        .data(filteredData)
        .enter()
        .append("g")
        .attr("transform", (d, i) => `translate(0 ${yAxisBand(i) + smallBarMargin})`)
        .each(createResourceBar);

    document.querySelector("body").groups = groups;
    return svg
}

severity = new Map([["Normal",0],["Warning",1],["Error",2]]);

function processAndSortResources(result) {
    let viewOptions = result.view_options;

    if (!result.rows) {
        data = {}
    } else {
        data = result.rows.map(d => {
            cmpFn = compareStartFn;
            switch (viewOptions.sort) {
                case "starttime":
                    cmpFn = compareStartFn;
                    break;
                case "name":
                    cmpFn = compareNameFn;
                    break;
                case "mostevents":
                    cmpFn = compareMostEventsFn;
                    break;
                default:
                    console.log("Unknown sort: " + viewOptions.sort);
                    break;
            }

            result = {
                ...d,
                start: d.start_date * 1000,
                end: (d.start_date * 1000) + (d.duration * 1000),
                overlays: d.overlays.map(e => {
                    // e is the Overlay struct defined in
                    // pkg/sloop/queries/types.go
                    let splitText = e.text.split(" ")
                    let worstSeverity = d3.max(splitText, text => {
                        return severity.get(text.split(":")[1])
                    });

                    let overlay = {
                        ...e,
                        start: (e.start_date * 1000),
                        end: (e.start_date * 1000) + (e.duration * 1000),
                        severity: worstSeverity,
                        reason: e.text,
                        count: splitText[2],
                    };
                    return overlay
                })
            };
            return result
        }).sort(cmpFn);
        return data
    }
}

function compareKind(a, b) {
    return ('' + a.kind).localeCompare(b.kind)
}

function appendAxes(svg) {
    line = svg.append("line")
        .attr("y1", yAxisBand.range()[0])
        .attr("y2", yAxisBand.range()[1])
        .attr("stroke", "rgba(0,0,0,0.5)")
        .style("pointer-events", "none");

    topAxis = svg
        .append("g")
        .attr("transform", () => `translate(0 ${yAxisBand.range()[0]})`)
        .call(topAxisDrawFunc)
        .attr("stroke", currentColorScheme.baseLight[1])
        .classed("topAxis", true);

    bottomAxis = svg
        .append("g")
        .attr("transform", () => `translate(0 ${yAxisBand.range()[1]})`)
        .call(bottomAxisDrawFunc)
        .attr("stroke", currentColorScheme.baseLight[1])
        .classed("bottomAxis", true);

}

function renderTooltip() {
    tooltip = d3.select("body")
        .append("div")
        .classed("tooltip", true)
}

function addEnhancedInteractions() {
    // Add keyboard navigation
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && detailedToolTipIsVisible) {
            hideDetailedTooltip();
        }
    });
    
    // Add smooth scrolling for better UX
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });
}

function bindMouseEvents(svg) {
    svg.on("mousemove", function () {
        let [x, y] = d3.mouse(this);

        if (xAxisScale.invert(x) < xAxisScale.domain()[0] || (xAxisScale.invert(x) > xAxisScale.domain()[1])) {
            console.log("Vertical bar out of bounds x")
        } else if (y < yAxisBand.range()[0] || (y > yAxisBand.range()[1])) {
            console.log("Vertical bar out of bounds top")
        } else {
            line.attr("transform", `translate(${x} 0)`);
            theTime = xAxisScale.invert(x);
            if (!detailedToolTipIsVisible) {
                let tooltipX = d3.event.pageX;
                let tooltipY = d3.event.pageY;
                positionTooltip(tooltipX, tooltipY);
            }
        }
    });

    g.selectAll(".resource").on("mouseover", function (d) {
        if (!detailedToolTipIsVisible) {
            d3.select(this).attr("fill", d.color.darker());
            tooltip.style("opacity", 1)
        }
    }).on("mouseleave", function (d) {
        if (!detailedToolTipIsVisible) {
            d3.select(this).attr("fill", d3.color(barColorGenFunc(d.kind)));
            tooltip.style("opacity", 0)
        }
    }).on("mousemove", function (d) {
        if (!detailedToolTipIsVisible) {
            d3.select(this).style("filter", "brightness(1.1)");
            tooltip.html(getResourceBarContent(
                {
                    title: d.text,
                    kind: d.kind,
                    namespace: d.namespace,
                    time: theTime
                }
            ))
        }
    }).on("click", function (d) {
        showDetailedTooltip(d, d3.event, this);
    });
    
    // Intuitively 'd' should be the 'heatmap' element - but for whatever reason
    // the event binds correctly but 'd' is the resource element. Not sure why - I think
    // d3 binds events strangely like that.
    g.selectAll(".heatmap").on("mouseover", function (d) {
        if (!detailedToolTipIsVisible) {
            let parentColor = d.color.darker();
            let overlayIndex = parseInt(this.getAttribute("index"));
            let thisOverlay = d.overlays[overlayIndex];

            d3.select(this).style("filter", "brightness(1.2) saturate(1.2)");
            d3.select(this.parentElement).select(".resource").attr("fill", parentColor);
            d3.select(this).attr("fill", d3.color(barColorGenFunc(thisOverlay.text)).darker());

            let content = {
                text: thisOverlay.text,
                kind: d.kind,
                namespace: d.namespace,
                title: d.text,
                start: thisOverlay.start,
                end: thisOverlay.end,
            };

            thisOverlay = d.overlays[overlayIndex];
            d3.select(this).attr("fill", d3.color(severityColorGenFunc(thisOverlay.severity)).darker());
            d.overlays[overlayIndex].title = this.getAttribute("title");
            tooltip
                .style("opacity", 1)
                .html(getHeatmapContent(content));
        }
    }).on("mouseleave", function (d) {
        if (!detailedToolTipIsVisible) {
            d3.select(this).style("filter", null);
            d3.select(this.parentElement).select(".resource").attr("fill", d.color);

            let overlayIndex = parseInt(this.getAttribute("index"));
            let thisOverlay = d.overlays[overlayIndex];
            d3.select(this).attr("fill", severityColorGenFunc(thisOverlay.severity));
            tooltip.style("opacity", 0)
        }
    }).on("click", function (d) {
        showDetailedTooltip(d, d3.event, this);
    });

    g.selectAll(".payloadChange").on("mouseover", function (d) {
        if (!detailedToolTipIsVisible) {
            let xPos = +d3.select(this).attr("x");
            let width = +d3.select(this).attr("width");
            let height = +d3.select(this).attr("height");
            let thisChange = parseInt(this.getAttribute("index")) * 1000;
            var changeBool;
            if (d3.select(this).attr("id").localeCompare("nochange")== 0) {
                changeBool = false;
            } else {
                changeBool = true;
            }

            let content = {
                title: d.text,
                time: thisChange, 
                change: changeBool 
            };

            d3.select(this).style("filter", "brightness(1.3)");
            d3.select(this).attr("x", xPos - 5).attr("width", width + 10);
            d3.select(this).attr("height", height + 10);
            tooltip
                .style("opacity", 1)
                .html(getChangeContent(content));
        }
    }).on("mouseleave", function (d) {
        if (!detailedToolTipIsVisible) {
            let xPos = +d3.select(this).attr("x");
            let width = +d3.select(this).attr("width");
            let height = +d3.select(this).attr("height");

            d3.select(this).style("filter", null);
            d3.select(this).attr("x", xPos + 5).attr("width", width-10).attr("height", height-10);
            tooltip.style("opacity", 0)
        }
    });

}

function hideDetailedTooltip() {
    detailedToolTipIsVisible = false;
    tooltip.style("opacity", 0);
    // Reset any hover states
    g.selectAll(".resource").attr("fill", d => d3.color(barColorGenFunc(d.kind)));
    g.selectAll(".heatmap").each(function(d) {
        let overlayIndex = parseInt(this.getAttribute("index"));
        let thisOverlay = d.overlays[overlayIndex];
        d3.select(this).attr("fill", severityColorGenFunc(thisOverlay.severity));
    });
}

function getHeatmapContent(d) {
    let allReasons = d.text.split(" ").reduce((r, l, i, a) => {
        let splitText = l.split(":");
        let severityText = splitText[1];
        let severityCode = severity.get(splitText[1]);
        let severityColor = currentColorScheme.severity[severityCode];
        let severityIcon = severityCode === 0 ? '✅' : severityCode === 1 ? '⚠️' : '❌';
        return `<tr>
                 <td><strong>${splitText[0]}</strong></td>
                 <td><strong>${splitText[2]}</strong></td> 
                 <td><span style="color:${severityColor}">${severityIcon} ${severityText}</span></td>
                 </tr>` + r
    }, "");

    let table = `<table style="width: 100%; margin-top: 12px; border-collapse: collapse;"> 
        <tr style="background: var(--accent-bg);"> 
            <th style="padding: 8px; border: 1px solid var(--border-color);">Reason</th> 
            <th style="padding: 8px; border: 1px solid var(--border-color);">Count</th> 
            <th style="padding: 8px; border: 1px solid var(--border-color);">Severity</th> 
        </tr> 
        ${allReasons} 
    </table>`;
    
    return `<div style="padding: 4px;">
        <div style="margin-bottom: 12px;">
            <strong style="color: var(--accent-blue);">${d.title}</strong><br/>
            <span style="color: var(--text-secondary);">Kind:</span> <strong>${d.kind}</strong><br/>
            <span style="color: var(--text-secondary);">Namespace:</span> <strong>${d.namespace}</strong>
        </div>
        ${table}
        <div style="margin-top: 12px; font-size: 12px; color: var(--text-secondary);">
            ${formatDateTime(d.start)} → ${formatDateTime(d.end)}
        </div>
    </div>`
}

function getResourceBarContent(d) {
    return `<div id="tiny-tooltip">
        <div style="margin-bottom: 8px;">
            <strong style="color: var(--accent-blue);">${d.title}</strong>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">
            <span>Kind:</span> <strong style="color: var(--text-primary);">${d.kind}</strong>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
            <span>Namespace:</span> <strong style="color: var(--text-primary);">${d.namespace}</strong>
        </div>
        <div style="font-size: 11px; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 8px;">
            ${formatDateTime(d.time)}
        </div>
    </div>`;
}

function getChangeContent(d) {
    const changeIcon = d.change ? '🔄' : '⏸️';
    const changeColor = d.change ? 'var(--accent-orange)' : 'var(--text-secondary)';
    const changeText = d.change ? 'Payload changed' : 'No payload change';
    
    if (d.change) {
        return `<div id="tiny-tooltip">
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--accent-blue);">${d.title}</strong>
            </div>
            <div style="color: ${changeColor};">
                ${changeIcon} ${changeText}
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 8px;">
                ${formatDateTime(d.time)}
            </div>
        </div>`
    } else {
        return `<div id="tiny-tooltip">
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--accent-blue);">${d.title}</strong>
            </div>
            <div style="color: ${changeColor};">
                ${changeIcon} ${changeText}
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 8px;">
                ${formatDateTime(d.time)}
            </div>
        </div>`
    }
}

function formatDateTime(d) {
    const date = new Date(d);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });
}

function createResourceBar(d) {
    const el = d3.select(this);
    const sx = xAxisScale(d.start);

    let w = Math.max(xAxisScale(d.end) - xAxisScale(d.start), 10);
    const isLabelRight = (sx > displayMaxX / 2 ? sx + w < displayMaxX : sx - w > 0);

    el
        .append("rect")
        .attr("x", sx)
        .attr("height", yAxisBand.bandwidth() - (2 * smallBarMargin))
        .attr("width", w)
        .attr("rx", 4)
        .attr("ry", 4)
        .attr("fill", barColorGenFunc(d.kind))
        .classed("resource", true);

    let n = 0;

    // Print overlay heatmap for each object
    d.overlays.forEach(function (overlay) {
        const overlaySX = xAxisScale(overlay.start);
        const overlayW = xAxisScale(overlay.end) - xAxisScale(overlay.start);

        if ((overlaySX < sx) || ((overlaySX + overlayW) > (sx + w))) {
            n++;
            console.log("Overlay out of bounds for resource");
        } else {
            let text = "";
            if (d.text) {
                text = d.text
            }

            el
                .append("rect")
                .attr("x", overlaySX)
                .attr("y", yAxisBand.bandwidth() * 0.15)
                .attr("rx", 3)
                .attr("ry", 3)
                .attr("height", yAxisBand.bandwidth() * 0.6)
                .attr("width", overlayW * 0.75)
                .attr("fill", d3.color(severityColorGenFunc(overlay.severity)))
                .attr("stroke", currentColorScheme.baseDark[3])
                .attr("stroke-width", "1px")
                .attr("title", text)
                .attr("transform", `translate(0 ${-smallBarMargin})`)
                .attr("index", n++)
                .classed("heatmap", true)
        }
    });

    if (d.nochangeat != null) {
        d.nochangeat.forEach(function (timestamp) {
            // add black tick mark at bottom of band - 1/10 of band
            el
                .append("rect")
                .attr("x", xAxisScale(timestamp*1000))
                .attr("y", 9 * (yAxisBand.bandwidth() / 10))
                .attr("height", yAxisBand.bandwidth() / 5)
                .attr("width", 3)
                .attr("rx", 1)
                .attr("fill", "white")
                .attr("index", timestamp)
                .classed("payloadChange", true)
                .attr("id", "nochange")
        });
    }

    if (d.changedat != null) {
        d.changedat.forEach(function (timestamp) {
            // add red tick mark at top of band - 1/5 of band
            el
                .append("rect")
                .attr("x", xAxisScale(timestamp*1000))
                .attr("height", yAxisBand.bandwidth() / 5)
                .attr("width", 3)
                .attr("rx", 1)
                .attr("fill", currentColorScheme.severity[2])
                .attr("index", timestamp)
                .classed("payloadChange", true)
                .attr("id", "change")        
        });
    }

    el.append("text")
        .text(d.text)
        .attr("x", isLabelRight ? sx - 5 : sx + w + 5)
        .attr("fill", currentColorScheme.baseLight[0])
        .classed("resource-bar-label", true)
        .style("text-anchor", isLabelRight ? "end" : "start");
}

function evalJSFromHtml(html) {
    let newElement = document.createElement('div');
    newElement.innerHTML = html;
    let scripts = newElement.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; ++i) {
        eval(scripts[i].innerHTML);
    }
}

function positionTooltip(x, y) {
    let tooltipX = x;
    let tooltipY = y;

    if (x > displayMaxX / 2) {
        tooltip.style("right", (displayMaxX - tooltipX) + "px");
        tooltip.style("left", null)
    } else {
        tooltip.style("left", tooltipX + "px");
        tooltip.style("right", null)
    }

    if (y > displayMaxY / 2) {
        tooltip.style("bottom", (displayMaxY - tooltipY) + "px");
        tooltip.style("top", null)
    } else {
        // It looks really goofy if you don't. 20px is about the size of the mouse on a 1080 scaled display
        tooltip.style("top", tooltipY + 20 + "px");
        tooltip.style("bottom", null)
    }

    if (detailedToolTipIsVisible) {
        tooltip.classed("ignore-pointer-events", false)
    } else {
        tooltip.classed("ignore-pointer-events", true)
    }
}

function showDetailedTooltip(d, event, parent) {
    let tooltipX = event.pageX;
    let tooltipY = event.pageY;
    if (detailedToolTipIsVisible) {
        let resourceBarHtml = getResourceBarContent(
            {
                title: d.text,
                kind: d.kind,
                namespace: d.namespace,
                time: theTime
            }
        );
        tooltip.html(resourceBarHtml);
        positionTooltip(tooltipX, tooltipY);
        detailedToolTipIsVisible = false
    } else {
        showLoadingState();
        let [x, y] = d3.mouse(parent);

        let tooltipX = event.pageX;
        let tooltipY = event.pageY;
        const resourceRequestPath = "resource";
        $.ajax({
            url: resourceRequestPath,
            data: {
                click_time: xAxisScale.invert(x).getTime(),
                name: d.text,
                namespace: d.namespace,
                kind: d.kind,
            },
            success: function (result) {
                detailedToolTipIsVisible = true;
                hideLoadingState();
                tooltip.html(result);
                evalJSFromHtml(result);
                positionTooltip(tooltipX, tooltipY)
            },
            error: function() {
                hideLoadingState();
                console.error('Failed to load resource details');
            }
        });
    }
}

$(document).ready(function() {
    //Set max allowed selected date/time to now
    const now = new Date();
    const utcNow = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());

    //Display user selected end time on ui after click submit button or refresh the page
    //Set page default to UTC time on first loading
    let userDate = utcNow;
    // check if selected end time happened within 3 seconds
    if (sessionStorage.getItem('setSelectedEndTime') !== null
        && ! Date.parse(sessionStorage.getItem('setSelectedEndTime')) < new Date(userDate.getTime() - 3000)){
        userDate = new Date(sessionStorage.getItem('selectedEndTime'));
    }
    userDate.setMinutes(userDate.getMinutes() - userDate.getTimezoneOffset());
    userDate.setMilliseconds(null);
    document.getElementById('selectedEndTime').value = userDate.toISOString().slice(0, -1);

    $('#now').click(function(){
        $(this).addClass('loading');
        const resetNow = new Date();
        resetNow.setMilliseconds(null);
        document.getElementById('selectedEndTime').value = resetNow.toISOString().slice(0, -1);
        sessionStorage.removeItem('selectedEndTime');
        sessionStorage.setItem('selectedEndTime', resetNow.toISOString().slice(0, -1));
        setTimeout(() => $(this).removeClass('loading'), 300);
    });
});
