#!/usr/bin/env node

const CDP = require('chrome-remote-interface');
const {program} = require('commander');
const fs = require('node:fs');

program
    .option('-H, --host <host>', 'Remote debugging protocol host', 'localhost')
    .option('-p, --port <port>', 'Remote debugging protocool port', '9876')
    .option('-s, --showcategories', 'Show categories')
    .option('-O, --output <path>', 'Output file', "")
    .option('-c, --categories <categories>', 'Set categories', "")
    .option('-e, --excludecategories <categories>', 'Exclude categories', "")
    .option('--systrace', 'Enable systrace')
    .option('--memory_dump_mode <mode>', 'Memory dump mode', "")
    .option('--memory_dump_interval <interval_in_ms>',
            'Memory dump interval in ms', 2000)
    .option('--dump_memory_at_stop')
    .parse(process.argv);

const cli_options = program.opts();

const cdp_options = {
  'host' : cli_options.host,
  'port' : cli_options.port,
};

function show_categories() {
  CDP(cdp_options, (client) => {
    const {Tracing} = client;
    Tracing.getCategories((message, result) => {
      result.categories.forEach(category => { console.log(category); });
      client.close();
    });
  }).on('error', (err) => { console.error(err); });
}

function trace_configuration_from_cli_options(opts) {
  let result = {
    dump_memory_mode : opts.memory_dump_mode,
    dump_memory_at_stop : opts.dump_memory_at_stop,
    dump_memory_interval : opts.memory_dump_interval,
    output_file : opts.output,
    trace_params : {traceConfig : {}, streamFormat : "json"}
  };

  if (opts.categories) {
    console.error("Categories: " + opts.categories);
    result.trace_params.traceConfig["includedCategories"] =
        opts.categories.split(",");
  }
  if (opts.excludecategories) {
    console.error("Excluded categories: " + opts.excludecategories);
    result.trace_params.traceConfig["excludedCategories"] =
        opts.excludecategories.split(",");
  }
  if (opts.systrace) {
    console.error("Systrace enabled");
    result.trace_params.traceConfig["enableSystrace"] = true;
  }
  if (opts.memory_dump_mode) {
    console.error("Memory dump enabled. Mode " + opts.memory_dump_mode +
                  ". Interval " + opts.memory_dump_interval + "ms");
    if (!result.trace_params.traceConfig["includedCategories"]) {
      result.trace_params.traceConfig["includedCategories"] = [ "*" ];
    }
    result.trace_params.traceConfig["includedCategories"].push(
        "disabled-by-default-memory-infra");
  }
  return result;
}

function dump_memory(tracing, trace_config) {
  const dump_options = {levelOfDetail : trace_config.dump_memory_mode};
  tracing.requestMemoryDump(dump_options)
      .then(
          function(result) {
            console.error(`Memory dump ${result.success ? "done" : "failed"}`);
          },
          function() { console.error("Memory dump failed"); });
}

function start_memory_dump(tracing, trace_config) {
  return setInterval(function() { dump_memory(tracing, trace_config); },
                     trace_config.dump_memory_interval);
}

async function capture_trace(trace_config) {
  CDP(cdp_options, (client) => {
    const {Tracing} = client;
    const data = {"traceEvents" : []};

    let dump_interval_id;

    client.on('Tracing.dataCollected', message => {
      data.trace_events = data.traceEvents =
          data.traceEvents.concat(message.value);
    });

    client.on('Tracing.tracingComplete', message => {
      const stringified_data = JSON.stringify(data);
      if (trace_config.output_file != '') {
        try  {
          fs.writeFileSync(trace_config.output_file, stringified_data);
        } catch (err) {
          console.error(err);
        }
      } else {
        console.log(stringified_data);
      }
      if (message.dataLossOcurred)
        console.error("Some data has been lost");
      client.close();
    });

    if (trace_config.dump_memory_mode != '') {
      dump_interval_id = start_memory_dump(Tracing, trace_config);
    }

    console.error("Traceconfig is " + JSON.stringify(trace_config));
    Tracing.start(trace_config.trace_params);
    process.on('SIGINT', function() {
      if (dump_interval_id) {
        clearInterval(dump_interval_id);
      }
      if (cli_options.dump_memory_at_stop) {
        console.error("Dumping memory at stop");
        dump_memory(Tracing, trace_config);
      }
      Tracing.end();
    });
  }).on('error', (err) => console.error(err));
}

if (cli_options.showcategories) {
  show_categories();
} else {
  const trace_config = trace_configuration_from_cli_options(cli_options);
  capture_trace(trace_config);
}
