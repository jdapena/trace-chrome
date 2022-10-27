var Chrome = require('chrome-remote-interface');
var program = require('commander');

program
    .option('-H, --host <host>', 'Remote debugging protocol host', 'localhost')
    .option('-p, --port <port>', 'Remote debugging protocool port', '9876')
    .option('-s, --showcategories', 'Show categories')
    .option('-c, --categories <categories>', 'Set categories', "")
    .option('-e, --excludecategories <categories>', 'Exclude categories', "")
    .option('--systrace', 'Enable systrace')
    .option('--memory_dump_mode <mode>', 'Memory dump mode', "")
    .option('--memory_dump_interval <interval_in_ms>',
            'Memory dump interval in ms', 2000)
    .option('--dump_memory_at_stop')
    .parse(process.argv);

var options = {
  'host' : program.host,
  'port' : program.port,
};

var dump_interval;

Chrome(options, function(chrome) {
  with(chrome) {

    function dump_memory() {
      Tracing.requestMemoryDump().then(
          function() { console.error("Memory dump done"); },
          function() { console.error("Memory dump failed"); });
    }

    if (program.showcategories) {
      Tracing.getCategories(function(message, result) {
        for (i = 0; i < result["categories"].length; i++) {
          console.log(result["categories"][i]);
        }
        close();
      });
    } else {
      a = {"traceEvents" : []};
      on('Tracing.dataCollected',
         function(
             message) { a.traceEvents = a.traceEvents.concat(message.value); });
      on('Tracing.tracingComplete', function() {
        console.log(JSON.stringify(a));
        close();
      });
      process.on('SIGINT', function() {
        if (dump_interval) {
          clearInterval(dump_interval);
        }
        if (program.dump_memory_at_stop) {
          console.error("Dumping memory at stop");
          dump_memory();
        }
        Tracing.end();
      });
      console.error("Connecting to: " + program.host + ":" + program.port);
      traceConfig = {};
      if (program.categories) {
        console.error("Categories: " + program.categories);
        traceConfig["includedCategories"] = program.categories.split(",");
      }
      if (program.excludecategories) {
        traceConfig["excludedCategories"] =
            program.excludecategories.split(",");
        console.error("Excluded categories: " + program.excludecategories);
      }
      if (program.systrace) {
        traceConfig["enable_systrace"] = true;
      }
      if (program.memory_dump_mode) {
        traceConfig["memory_dump_config"] = {
          "triggers" : [ {
            "mode" : program.memory_dump_mode,
            "periodic_interval_ms" : program.memory_dump_interval
          } ]
        }

        dump_interval = setInterval(dump_memory, program.memory_dump_interval);
      }
      console.error("Traceconfig is " + JSON.stringify(traceConfig));
      Tracing.start({"traceConfig" : traceConfig, "streamFormat" : "json"});
    }
  }
}).on('error', function() { console.error('Cannot connect to Chrome'); });
