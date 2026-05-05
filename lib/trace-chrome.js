'use strict';

const chromeRemoteInterface = require('chrome-remote-interface');
const fs = require('node:fs');

const criOptions = {
  'host': 'localhost',
  'port': 9876,
};

exports.setCriOptions = function(host, port) {
  criOptions.host = host || criOptions.host;
  criOptions.port = port || criOptions.port;
};

exports.getCriOptions = function() {
  return {host: criOptions.host, port: criOptions.port};
};

async function fetchCategoryList() {
  const client = await chromeRemoteInterface(criOptions);
  try {
    const result = await client.Tracing.getCategories();
    return result.categories || [];
  } finally {
    client.close();
  }
}

exports.getCategories = async function() {
  const all = await fetchCategoryList();
  const regular = [];
  const disabledByDefault = [];
  all.forEach((cat) => {
    if (cat.indexOf('disabled-by-default-') === 0) {
      disabledByDefault.push(cat);
    } else {
      regular.push(cat);
    }
  });
  regular.sort();
  disabledByDefault.sort();
  return {regular, disabledByDefault};
};

exports.showCategories = function() {
  fetchCategoryList()
      .then((cats) => cats.forEach((c) => console.log(c)))
      .catch((err) => console.error(err));
};

function dumpMemory(tracing, traceConfig) {
  const dumpOptions = {levelOfDetail: traceConfig.dump_memory_mode};
  return tracing.requestMemoryDump(dumpOptions).then(
      function(result) {
        console.error(`Memory dump ${result.success ? 'done' : 'failed'}`);
      },
      function() {
        console.error('Memory dump failed');
      });
}

function startMemoryDump(tracing, traceConfig) {
  return setInterval(function() {
    dumpMemory(tracing, traceConfig);
  },
  traceConfig.dump_memory_interval);
}

exports.buildTraceConfig = function(opts, options) {
  const log = !options || options.log !== false;
  const result = {
    dump_memory_mode: opts.memory_dump_mode || '',
    dump_memory_at_stop: !!opts.dump_memory_at_stop,
    dump_memory_interval: opts.memory_dump_interval || 2000,
    output_file: opts.output || '',
    trace_params: {traceConfig: {}, streamFormat: 'json'},
  };

  if (opts.categories) {
    if (log) console.error('Categories: ' + opts.categories);
    result.trace_params.traceConfig['includedCategories'] =
        opts.categories.split(',');
  }
  if (opts.excludecategories) {
    if (log) console.error('Excluded categories: ' + opts.excludecategories);
    result.trace_params.traceConfig['excludedCategories'] =
        opts.excludecategories.split(',');
  }
  if (opts.systrace) {
    if (log) console.error('Systrace enabled');
    result.trace_params.traceConfig['enableSystrace'] = true;
  }
  if (result.dump_memory_mode) {
    if (log) {
      console.error('Memory dump enabled. Mode ' + result.dump_memory_mode +
          '. Interval ' + result.dump_memory_interval + 'ms');
    }
    if (!result.trace_params.traceConfig['includedCategories']) {
      result.trace_params.traceConfig['includedCategories'] = ['*'];
    }
    result.trace_params.traceConfig['includedCategories'].push(
        'disabled-by-default-memory-infra');
  }
  return result;
};

exports.startCapture = async function(traceConfig) {
  const client = await chromeRemoteInterface(criOptions);
  const {Tracing} = client;
  const data = {'traceEvents': []};

  let dumpIntervalId = null;
  let settled = false;
  let resolveData;
  const dataPromise = new Promise((resolve) => {
    resolveData = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  client.on('Tracing.dataCollected', (message) => {
    data.trace_events = data.traceEvents =
        data.traceEvents.concat(message.value);
  });

  client.on('Tracing.tracingComplete', (message) => {
    if (message.dataLossOcurred) {
      console.error('Some data has been lost');
    }
    resolveData(data);
    client.close();
  });

  client.on('disconnect', () => {
    data.incomplete = true;
    resolveData(data);
  });

  console.error('Traceconfig is ' + JSON.stringify(traceConfig));
  await Tracing.start(traceConfig.trace_params);
  if (traceConfig.dump_memory_mode) {
    dumpIntervalId = startMemoryDump(Tracing, traceConfig);
  }

  const startedAt = Date.now();
  let stopping = false;
  async function stop() {
    if (stopping) return dataPromise;
    stopping = true;
    if (dumpIntervalId) {
      clearInterval(dumpIntervalId);
    }
    if (traceConfig.dump_memory_at_stop) {
      console.error('Dumping memory at stop');
      await dumpMemory(Tracing, traceConfig);
    }
    try {
      await Tracing.end();
    } catch (err) {
      console.error('Tracing.end failed: ' + (err && err.message));
    }
    return dataPromise;
  }

  return {stop, startedAt};
};

exports.captureTrace = async function(traceConfig) {
  let handle;
  try {
    handle = await exports.startCapture(traceConfig);
  } catch (err) {
    console.error(err);
    return;
  }
  process.on('SIGINT', async function() {
    try {
      const data = await handle.stop();
      const stringifiedData = JSON.stringify(data);
      if (traceConfig.output_file != '') {
        fs.writeFileSync(traceConfig.output_file, stringifiedData);
      } else {
        console.log(stringifiedData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      process.exit(0);
    }
  });
};
