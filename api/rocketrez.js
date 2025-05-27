// api/rocketrez.js - Vercel Serverless Function
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { siteId = '2', date, username, password } = req.query;

    if (!username || !password) {
      res.status(400).json({ 
        error: 'Missing required parameters: username, password',
        usage: '?username=your_user&password=your_pass&siteId=2&date=2025-05-27'
      });
      return;
    }

    const selectedDate = date || new Date().toISOString().split('T')[0];
    const rocketrezUrl = `https://secure.rocket-rez.com/RocketAPI/v1/tourschedules?SiteId=${siteId}&SelectedDate=${selectedDate}`;
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');

    console.log(`Fetching: ${rocketrezUrl}`);

    const response = await fetch(rocketrezUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Wendella-Proxy/1.0'
      }
    });

    console.log(`Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`RocketRez error: ${errorText}`);
      
      res.status(response.status).json({
        error: `RocketRez API returned ${response.status}`,
        message: response.statusText,
        details: errorText.substring(0, 300),
        url: rocketrezUrl,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const data = await response.json();
    console.log(`Data keys: ${Object.keys(data || {})}`);

    const processedData = processScheduleData(data);

    res.status(200).json({
      success: true,
      data: processedData,
      lastUpdated: new Date().toISOString(),
      totalSchedules: processedData.length,
      source: 'RocketRez via Vercel',
      debugInfo: {
        originalDataKeys: Object.keys(data || {}),
        rawDataPreview: JSON.stringify(data).substring(0, 200)
      }
    });

  } catch (error) {
    console.error('Proxy error:', error);
    
    res.status(500).json({
      error: 'Proxy server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

function processScheduleData(data) {
  console.log('Processing data:', typeof data, Object.keys(data || {}));

  let schedules = [];

  // Handle different possible data structures
  if (Array.isArray(data)) {
    schedules = data;
  } else if (data?.Sites) {
    const sites = Array.isArray(data.Sites) ? data.Sites[0] : data.Sites;
    schedules = sites?.Schedules || [];
  } else if (data?.schedules) {
    schedules = data.schedules;
  } else if (data?.Schedules) {
    schedules = data.Schedules;
  } else if (data?.data) {
    schedules = Array.isArray(data.data) ? data.data : [data.data];
  }

  if (!Array.isArray(schedules)) {
    console.log('No valid schedules array found, returning empty array');
    return [];
  }

  const now = new Date();
  const processedSchedules = [];

  schedules.forEach((item, index) => {
    try {
      const tourName = item.TourName || item.tourName || item.name || item.title;
      const startTime = item.StartTime || item.startTime || item.start;
      const endTime = item.EndTime || item.endTime || item.end;
      
      if (!tourName || !startTime) {
        console.log(`Skipping item ${index}: missing tourName or startTime`);
        return;
      }

      const endDate = endTime ? new Date(endTime) : new Date(startTime);
      
      // Skip past tours
      if (endDate < now) return;
      
      // Skip private/canceled tours
      const name = tourName.toLowerCase();
      if (name.includes('private') || 
          name.includes('canceled') || 
          name.includes('cancelled') ||
          name.includes('test')) {
        return;
      }

      const schedule = {
        tourName: tourName,
        startTime: startTime,
        endTime: endTime || startTime,
        available: parseInt(item.Available || item.available || item.seats || 0),
        duration: parseInt(item.Duration || item.duration || 75),
        scheduleId: item.ScheduleId || item.scheduleId || item.id,
        tourId: item.TourId || item.tourId,
        customFields: {
          field1: item.CustomFieldValue1 || item.description || '',
          field2: item.CustomFieldValue2 || '',
          field3: item.CustomFieldValue3 || '',
          field4: item.CustomFieldValue4 || ''
        }
      };

      processedSchedules.push(schedule);

    } catch (error) {
      console.error(`Error processing schedule ${index}:`, error);
    }
  });

  processedSchedules.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  console.log(`Processed ${processedSchedules.length} valid schedules`);
  return processedSchedules;
}
