I want you to redesign my charting module to match the quality and responsiveness of professional trading platforms like StockMojo, Sensibull, TradingView dashboards, and institutional analytics platforms.

IMPORTANT:
Do NOT use Python plotting libraries such as Matplotlib or Plotly for rendering charts inside the web application.

My technology stack is:

Backend:
- FastAPI
- PostgreSQL
- SQLAlchemy ORM
- WebSocket support

Frontend:
- React
- TypeScript
- Vite

Chart Library:
- Apache ECharts using echarts-for-react

The charts must be built completely using Apache ECharts.

=====================================
OVERALL ARCHITECTURE
=====================================

Broker Data
        ↓
FastAPI
        ↓
Data Processing Layer
        ↓
PostgreSQL
        ↓
REST API + WebSocket
        ↓
React
        ↓
Apache ECharts

The backend is only responsible for fetching, processing, aggregating, and serving data.

The frontend is responsible for rendering every chart using Apache ECharts.

=====================================
CHART REQUIREMENTS
=====================================

Create a professional financial dashboard with the same interaction style as StockMojo.

The dashboard should contain multiple independent charts.

Examples:

• Multi OI & Volume
• Multi Strike OI Change
• PCR
• Gamma Exposure
• Price vs OI
• Volume Analysis

Each chart should be its own reusable React component.

=====================================
MAIN CHART
=====================================

The main chart should display three synchronized line series.

Series 1
Future Price
- Grey dotted line
- Uses left Y-axis

Series 2
Total Call OI
- Green line
- Uses right Y-axis

Series 3
Total Put OI
- Red line
- Uses right Y-axis

=====================================
AXES
=====================================

X-axis:
Time

Example:

09:15
09:16
09:17
...

Left Y-axis:
Future Price

Example

23950
24000
24050
24100

Right Y-axis:
Open Interest

Example

1.2 Cr
1.4 Cr
1.6 Cr
2.0 Cr
2.4 Cr
3.0 Cr

The two axes must scale independently.

=====================================
TOOLTIPS
=====================================

Hovering anywhere should display a shared tooltip containing values of every series.

Example:

2 Jul, 12:28 PM

Future Price:
24151.45

Total Call OI:
2.52 Cr

Total Put OI:
2.43 Cr

Use ECharts axis trigger.

Enable crosshair.

Enable synchronized axis pointer.

=====================================
CURSOR
=====================================

Display

• Vertical dashed guide line
• Horizontal guide line
• Crosshair
• Smooth hover animation

=====================================
LEGEND
=====================================

Top left legend.

Example

● Future

● Total Call OI

● Total Put OI

Clicking a legend should toggle that series.

=====================================
GRID
=====================================

Professional dark trading theme.

Dark background

Thin grid lines

Subtle borders

No excessive colors.

=====================================
LINE STYLE
=====================================

Future Price

Grey
Dashed
Smooth

Total Call OI

Green
Solid
Smooth

Total Put OI

Red
Solid
Smooth

Support configurable line thickness.

=====================================
LIVE DATA
=====================================

Charts must support live updates without recreating the chart.

Backend pushes updates through WebSocket.

React receives new data.

Update only the changed series using ECharts setOption().

Never destroy and recreate the chart.

=====================================
ZOOM
=====================================

Support

Mouse wheel zoom

Drag zoom

Reset zoom

DataZoom slider

=====================================
PERFORMANCE
=====================================

Optimize for:

10,000+

50,000+

100,000+

data points.

Avoid unnecessary React re-renders.

Memoize chart options.

Only update modified series.

=====================================
BACKEND RESPONSE
=====================================

FastAPI should return JSON similar to:

{
  "timestamps": [
    "09:15",
    "09:16",
    "09:17"
  ],
  "future_price": [
    24100,
    24105,
    24108
  ],
  "total_call_oi": [
    21000000,
    21200000,
    21500000
  ],
  "total_put_oi": [
    19800000,
    20100000,
    20400000
  ]
}

=====================================
REACT STRUCTURE
=====================================

Organize the code into reusable components.

Example:

components/
    charts/
        MultiOIChart.tsx
        PriceOIChart.tsx
        PCRChart.tsx
        VolumeChart.tsx
        GammaChart.tsx

hooks/
    useChartData.ts
    useWebSocket.ts

services/
    chartApi.ts

types/
    chart.ts

utils/
    chartConfig.ts

=====================================
ECHARTS FEATURES TO USE
=====================================

Use Apache ECharts features including:

- Multiple Y axes
- Axis Pointer
- Tooltip trigger = axis
- Crosshair
- DataZoom
- Legend
- Grid
- Smooth lines
- Animation
- Progressive rendering
- Large dataset optimization
- Resize observer
- Responsive layout
- Dark theme

=====================================
CODE QUALITY
=====================================

Write production-quality code.

Use TypeScript.

Use reusable components.

Avoid duplicate code.

Follow React best practices.

Separate configuration from rendering.

Write maintainable code.

Document important sections.

=====================================
EXPECTED RESULT
=====================================

The final UI should look and behave like a professional institutional trading dashboard similar to StockMojo, with smooth interactions, synchronized crosshairs, dual Y-axes, responsive performance, live updates through WebSockets, and a polished dark theme built entirely with Apache ECharts.