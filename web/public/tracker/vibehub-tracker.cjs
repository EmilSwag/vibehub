#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from == "object" || typeof from == "function")
    for (let key of __getOwnPropNames(from))
      !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: !0 }) : target,
  mod
));

// ../node_modules/commander/lib/error.js
var require_error = __commonJS({
  "../node_modules/commander/lib/error.js"(exports2) {
    var CommanderError2 = class extends Error {
      /**
       * Constructs the CommanderError class
       * @param {number} exitCode suggested exit code which could be used with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       */
      constructor(exitCode, code, message) {
        super(message), Error.captureStackTrace(this, this.constructor), this.name = this.constructor.name, this.code = code, this.exitCode = exitCode, this.nestedError = void 0;
      }
    }, InvalidArgumentError2 = class extends CommanderError2 {
      /**
       * Constructs the InvalidArgumentError class
       * @param {string} [message] explanation of why argument is invalid
       */
      constructor(message) {
        super(1, "commander.invalidArgument", message), Error.captureStackTrace(this, this.constructor), this.name = this.constructor.name;
      }
    };
    exports2.CommanderError = CommanderError2;
    exports2.InvalidArgumentError = InvalidArgumentError2;
  }
});

// ../node_modules/commander/lib/argument.js
var require_argument = __commonJS({
  "../node_modules/commander/lib/argument.js"(exports2) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error(), Argument2 = class {
      /**
       * Initialize a new command argument with the given name and description.
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @param {string} name
       * @param {string} [description]
       */
      constructor(name, description) {
        switch (this.description = description || "", this.variadic = !1, this.parseArg = void 0, this.defaultValue = void 0, this.defaultValueDescription = void 0, this.argChoices = void 0, name[0]) {
          case "<":
            this.required = !0, this._name = name.slice(1, -1);
            break;
          case "[":
            this.required = !1, this._name = name.slice(1, -1);
            break;
          default:
            this.required = !0, this._name = name;
            break;
        }
        this._name.length > 3 && this._name.slice(-3) === "..." && (this.variadic = !0, this._name = this._name.slice(0, -3));
      }
      /**
       * Return argument name.
       *
       * @return {string}
       */
      name() {
        return this._name;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        return previous === this.defaultValue || !Array.isArray(previous) ? [value] : previous.concat(value);
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Argument}
       */
      default(value, description) {
        return this.defaultValue = value, this.defaultValueDescription = description, this;
      }
      /**
       * Set the custom handler for processing CLI command arguments into argument values.
       *
       * @param {Function} [fn]
       * @return {Argument}
       */
      argParser(fn) {
        return this.parseArg = fn, this;
      }
      /**
       * Only allow argument value to be one of choices.
       *
       * @param {string[]} values
       * @return {Argument}
       */
      choices(values) {
        return this.argChoices = values.slice(), this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg))
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          return this.variadic ? this._concatValue(arg, previous) : arg;
        }, this;
      }
      /**
       * Make argument required.
       *
       * @returns {Argument}
       */
      argRequired() {
        return this.required = !0, this;
      }
      /**
       * Make argument optional.
       *
       * @returns {Argument}
       */
      argOptional() {
        return this.required = !1, this;
      }
    };
    function humanReadableArgName(arg) {
      let nameOutput = arg.name() + (arg.variadic === !0 ? "..." : "");
      return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
    }
    exports2.Argument = Argument2;
    exports2.humanReadableArgName = humanReadableArgName;
  }
});

// ../node_modules/commander/lib/help.js
var require_help = __commonJS({
  "../node_modules/commander/lib/help.js"(exports2) {
    var { humanReadableArgName } = require_argument(), Help2 = class {
      constructor() {
        this.helpWidth = void 0, this.sortSubcommands = !1, this.sortOptions = !1, this.showGlobalOptions = !1;
      }
      /**
       * Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
       *
       * @param {Command} cmd
       * @returns {Command[]}
       */
      visibleCommands(cmd) {
        let visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden), helpCommand = cmd._getHelpCommand();
        return helpCommand && !helpCommand._hidden && visibleCommands.push(helpCommand), this.sortSubcommands && visibleCommands.sort((a, b) => a.name().localeCompare(b.name())), visibleCommands;
      }
      /**
       * Compare options for sort.
       *
       * @param {Option} a
       * @param {Option} b
       * @returns {number}
       */
      compareOptions(a, b) {
        let getSortKey = (option) => option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
        return getSortKey(a).localeCompare(getSortKey(b));
      }
      /**
       * Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleOptions(cmd) {
        let visibleOptions = cmd.options.filter((option) => !option.hidden), helpOption = cmd._getHelpOption();
        if (helpOption && !helpOption.hidden) {
          let removeShort = helpOption.short && cmd._findOption(helpOption.short), removeLong = helpOption.long && cmd._findOption(helpOption.long);
          !removeShort && !removeLong ? visibleOptions.push(helpOption) : helpOption.long && !removeLong ? visibleOptions.push(
            cmd.createOption(helpOption.long, helpOption.description)
          ) : helpOption.short && !removeShort && visibleOptions.push(
            cmd.createOption(helpOption.short, helpOption.description)
          );
        }
        return this.sortOptions && visibleOptions.sort(this.compareOptions), visibleOptions;
      }
      /**
       * Get an array of the visible global options. (Not including help.)
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleGlobalOptions(cmd) {
        if (!this.showGlobalOptions) return [];
        let globalOptions = [];
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          let visibleOptions = ancestorCmd.options.filter(
            (option) => !option.hidden
          );
          globalOptions.push(...visibleOptions);
        }
        return this.sortOptions && globalOptions.sort(this.compareOptions), globalOptions;
      }
      /**
       * Get an array of the arguments if any have a description.
       *
       * @param {Command} cmd
       * @returns {Argument[]}
       */
      visibleArguments(cmd) {
        return cmd._argsDescription && cmd.registeredArguments.forEach((argument) => {
          argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
        }), cmd.registeredArguments.find((argument) => argument.description) ? cmd.registeredArguments : [];
      }
      /**
       * Get the command term to show in the list of subcommands.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandTerm(cmd) {
        let args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
        return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + // simplistic check for non-help option
        (args ? " " + args : "");
      }
      /**
       * Get the option term to show in the list of options.
       *
       * @param {Option} option
       * @returns {string}
       */
      optionTerm(option) {
        return option.flags;
      }
      /**
       * Get the argument term to show in the list of arguments.
       *
       * @param {Argument} argument
       * @returns {string}
       */
      argumentTerm(argument) {
        return argument.name();
      }
      /**
       * Get the longest command term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestSubcommandTermLength(cmd, helper) {
        return helper.visibleCommands(cmd).reduce((max, command) => Math.max(max, helper.subcommandTerm(command).length), 0);
      }
      /**
       * Get the longest option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestOptionTermLength(cmd, helper) {
        return helper.visibleOptions(cmd).reduce((max, option) => Math.max(max, helper.optionTerm(option).length), 0);
      }
      /**
       * Get the longest global option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestGlobalOptionTermLength(cmd, helper) {
        return helper.visibleGlobalOptions(cmd).reduce((max, option) => Math.max(max, helper.optionTerm(option).length), 0);
      }
      /**
       * Get the longest argument term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestArgumentTermLength(cmd, helper) {
        return helper.visibleArguments(cmd).reduce((max, argument) => Math.max(max, helper.argumentTerm(argument).length), 0);
      }
      /**
       * Get the command usage to be displayed at the top of the built-in help.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandUsage(cmd) {
        let cmdName = cmd._name;
        cmd._aliases[0] && (cmdName = cmdName + "|" + cmd._aliases[0]);
        let ancestorCmdNames = "";
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent)
          ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
        return ancestorCmdNames + cmdName + " " + cmd.usage();
      }
      /**
       * Get the description for the command.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandDescription(cmd) {
        return cmd.description();
      }
      /**
       * Get the subcommand summary to show in the list of subcommands.
       * (Fallback to description for backwards compatibility.)
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandDescription(cmd) {
        return cmd.summary() || cmd.description();
      }
      /**
       * Get the option description to show in the list of options.
       *
       * @param {Option} option
       * @return {string}
       */
      optionDescription(option) {
        let extraInfo = [];
        return option.argChoices && extraInfo.push(
          // use stringify to match the display of the default value
          `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
        ), option.defaultValue !== void 0 && (option.required || option.optional || option.isBoolean() && typeof option.defaultValue == "boolean") && extraInfo.push(
          `default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`
        ), option.presetArg !== void 0 && option.optional && extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`), option.envVar !== void 0 && extraInfo.push(`env: ${option.envVar}`), extraInfo.length > 0 ? `${option.description} (${extraInfo.join(", ")})` : option.description;
      }
      /**
       * Get the argument description to show in the list of arguments.
       *
       * @param {Argument} argument
       * @return {string}
       */
      argumentDescription(argument) {
        let extraInfo = [];
        if (argument.argChoices && extraInfo.push(
          // use stringify to match the display of the default value
          `choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
        ), argument.defaultValue !== void 0 && extraInfo.push(
          `default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`
        ), extraInfo.length > 0) {
          let extraDescripton = `(${extraInfo.join(", ")})`;
          return argument.description ? `${argument.description} ${extraDescripton}` : extraDescripton;
        }
        return argument.description;
      }
      /**
       * Generate the built-in help text.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {string}
       */
      formatHelp(cmd, helper) {
        let termWidth = helper.padWidth(cmd, helper), helpWidth = helper.helpWidth || 80, itemIndentWidth = 2, itemSeparatorWidth = 2;
        function formatItem(term, description) {
          if (description) {
            let fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
            return helper.wrap(
              fullText,
              helpWidth - itemIndentWidth,
              termWidth + itemSeparatorWidth
            );
          }
          return term;
        }
        function formatList(textArray) {
          return textArray.join(`
`).replace(/^/gm, " ".repeat(itemIndentWidth));
        }
        let output = [`Usage: ${helper.commandUsage(cmd)}`, ""], commandDescription = helper.commandDescription(cmd);
        commandDescription.length > 0 && (output = output.concat([
          helper.wrap(commandDescription, helpWidth, 0),
          ""
        ]));
        let argumentList = helper.visibleArguments(cmd).map((argument) => formatItem(
          helper.argumentTerm(argument),
          helper.argumentDescription(argument)
        ));
        argumentList.length > 0 && (output = output.concat(["Arguments:", formatList(argumentList), ""]));
        let optionList = helper.visibleOptions(cmd).map((option) => formatItem(
          helper.optionTerm(option),
          helper.optionDescription(option)
        ));
        if (optionList.length > 0 && (output = output.concat(["Options:", formatList(optionList), ""])), this.showGlobalOptions) {
          let globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => formatItem(
            helper.optionTerm(option),
            helper.optionDescription(option)
          ));
          globalOptionList.length > 0 && (output = output.concat([
            "Global Options:",
            formatList(globalOptionList),
            ""
          ]));
        }
        let commandList = helper.visibleCommands(cmd).map((cmd2) => formatItem(
          helper.subcommandTerm(cmd2),
          helper.subcommandDescription(cmd2)
        ));
        return commandList.length > 0 && (output = output.concat(["Commands:", formatList(commandList), ""])), output.join(`
`);
      }
      /**
       * Calculate the pad width from the maximum term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      padWidth(cmd, helper) {
        return Math.max(
          helper.longestOptionTermLength(cmd, helper),
          helper.longestGlobalOptionTermLength(cmd, helper),
          helper.longestSubcommandTermLength(cmd, helper),
          helper.longestArgumentTermLength(cmd, helper)
        );
      }
      /**
       * Wrap the given string to width characters per line, with lines after the first indented.
       * Do not wrap if insufficient room for wrapping (minColumnWidth), or string is manually formatted.
       *
       * @param {string} str
       * @param {number} width
       * @param {number} indent
       * @param {number} [minColumnWidth=40]
       * @return {string}
       *
       */
      wrap(str, width, indent, minColumnWidth = 40) {
        let indents = " \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF", manualIndent = new RegExp(`[\\n][${indents}]+`);
        if (str.match(manualIndent)) return str;
        let columnWidth = width - indent;
        if (columnWidth < minColumnWidth) return str;
        let leadingStr = str.slice(0, indent), columnText = str.slice(indent).replace(`\r
`, `
`), indentString = " ".repeat(indent), breaks = "\\s\u200B", regex = new RegExp(
          `
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`,
          "g"
        ), lines = columnText.match(regex) || [];
        return leadingStr + lines.map((line, i) => line === `
` ? "" : (i > 0 ? indentString : "") + line.trimEnd()).join(`
`);
      }
    };
    exports2.Help = Help2;
  }
});

// ../node_modules/commander/lib/option.js
var require_option = __commonJS({
  "../node_modules/commander/lib/option.js"(exports2) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error(), Option2 = class {
      /**
       * Initialize a new `Option` with the given `flags` and `description`.
       *
       * @param {string} flags
       * @param {string} [description]
       */
      constructor(flags, description) {
        this.flags = flags, this.description = description || "", this.required = flags.includes("<"), this.optional = flags.includes("["), this.variadic = /\w\.\.\.[>\]]$/.test(flags), this.mandatory = !1;
        let optionFlags = splitOptionFlags(flags);
        this.short = optionFlags.shortFlag, this.long = optionFlags.longFlag, this.negate = !1, this.long && (this.negate = this.long.startsWith("--no-")), this.defaultValue = void 0, this.defaultValueDescription = void 0, this.presetArg = void 0, this.envVar = void 0, this.parseArg = void 0, this.hidden = !1, this.argChoices = void 0, this.conflictsWith = [], this.implied = void 0;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Option}
       */
      default(value, description) {
        return this.defaultValue = value, this.defaultValueDescription = description, this;
      }
      /**
       * Preset to use when option used without option-argument, especially optional but also boolean and negated.
       * The custom processing (parseArg) is called.
       *
       * @example
       * new Option('--color').default('GREYSCALE').preset('RGB');
       * new Option('--donate [amount]').preset('20').argParser(parseFloat);
       *
       * @param {*} arg
       * @return {Option}
       */
      preset(arg) {
        return this.presetArg = arg, this;
      }
      /**
       * Add option name(s) that conflict with this option.
       * An error will be displayed if conflicting options are found during parsing.
       *
       * @example
       * new Option('--rgb').conflicts('cmyk');
       * new Option('--js').conflicts(['ts', 'jsx']);
       *
       * @param {(string | string[])} names
       * @return {Option}
       */
      conflicts(names) {
        return this.conflictsWith = this.conflictsWith.concat(names), this;
      }
      /**
       * Specify implied option values for when this option is set and the implied options are not.
       *
       * The custom processing (parseArg) is not called on the implied values.
       *
       * @example
       * program
       *   .addOption(new Option('--log', 'write logging information to file'))
       *   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
       *
       * @param {object} impliedOptionValues
       * @return {Option}
       */
      implies(impliedOptionValues) {
        let newImplied = impliedOptionValues;
        return typeof impliedOptionValues == "string" && (newImplied = { [impliedOptionValues]: !0 }), this.implied = Object.assign(this.implied || {}, newImplied), this;
      }
      /**
       * Set environment variable to check for option value.
       *
       * An environment variable is only used if when processed the current option value is
       * undefined, or the source of the current value is 'default' or 'config' or 'env'.
       *
       * @param {string} name
       * @return {Option}
       */
      env(name) {
        return this.envVar = name, this;
      }
      /**
       * Set the custom handler for processing CLI option arguments into option values.
       *
       * @param {Function} [fn]
       * @return {Option}
       */
      argParser(fn) {
        return this.parseArg = fn, this;
      }
      /**
       * Whether the option is mandatory and must have a value after parsing.
       *
       * @param {boolean} [mandatory=true]
       * @return {Option}
       */
      makeOptionMandatory(mandatory = !0) {
        return this.mandatory = !!mandatory, this;
      }
      /**
       * Hide option in help.
       *
       * @param {boolean} [hide=true]
       * @return {Option}
       */
      hideHelp(hide = !0) {
        return this.hidden = !!hide, this;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        return previous === this.defaultValue || !Array.isArray(previous) ? [value] : previous.concat(value);
      }
      /**
       * Only allow option value to be one of choices.
       *
       * @param {string[]} values
       * @return {Option}
       */
      choices(values) {
        return this.argChoices = values.slice(), this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg))
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          return this.variadic ? this._concatValue(arg, previous) : arg;
        }, this;
      }
      /**
       * Return option name.
       *
       * @return {string}
       */
      name() {
        return this.long ? this.long.replace(/^--/, "") : this.short.replace(/^-/, "");
      }
      /**
       * Return option name, in a camelcase format that can be used
       * as a object attribute key.
       *
       * @return {string}
       */
      attributeName() {
        return camelcase(this.name().replace(/^no-/, ""));
      }
      /**
       * Check if `arg` matches the short or long flag.
       *
       * @param {string} arg
       * @return {boolean}
       * @package
       */
      is(arg) {
        return this.short === arg || this.long === arg;
      }
      /**
       * Return whether a boolean option.
       *
       * Options are one of boolean, negated, required argument, or optional argument.
       *
       * @return {boolean}
       * @package
       */
      isBoolean() {
        return !this.required && !this.optional && !this.negate;
      }
    }, DualOptions = class {
      /**
       * @param {Option[]} options
       */
      constructor(options) {
        this.positiveOptions = /* @__PURE__ */ new Map(), this.negativeOptions = /* @__PURE__ */ new Map(), this.dualOptions = /* @__PURE__ */ new Set(), options.forEach((option) => {
          option.negate ? this.negativeOptions.set(option.attributeName(), option) : this.positiveOptions.set(option.attributeName(), option);
        }), this.negativeOptions.forEach((value, key) => {
          this.positiveOptions.has(key) && this.dualOptions.add(key);
        });
      }
      /**
       * Did the value come from the option, and not from possible matching dual option?
       *
       * @param {*} value
       * @param {Option} option
       * @returns {boolean}
       */
      valueFromOption(value, option) {
        let optionKey = option.attributeName();
        if (!this.dualOptions.has(optionKey)) return !0;
        let preset = this.negativeOptions.get(optionKey).presetArg, negativeValue = preset !== void 0 ? preset : !1;
        return option.negate === (negativeValue === value);
      }
    };
    function camelcase(str) {
      return str.split("-").reduce((str2, word) => str2 + word[0].toUpperCase() + word.slice(1));
    }
    function splitOptionFlags(flags) {
      let shortFlag, longFlag, flagParts = flags.split(/[ |,]+/);
      return flagParts.length > 1 && !/^[[<]/.test(flagParts[1]) && (shortFlag = flagParts.shift()), longFlag = flagParts.shift(), !shortFlag && /^-[^-]$/.test(longFlag) && (shortFlag = longFlag, longFlag = void 0), { shortFlag, longFlag };
    }
    exports2.Option = Option2;
    exports2.DualOptions = DualOptions;
  }
});

// ../node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS({
  "../node_modules/commander/lib/suggestSimilar.js"(exports2) {
    function editDistance(a, b) {
      if (Math.abs(a.length - b.length) > 3)
        return Math.max(a.length, b.length);
      let d = [];
      for (let i = 0; i <= a.length; i++)
        d[i] = [i];
      for (let j = 0; j <= b.length; j++)
        d[0][j] = j;
      for (let j = 1; j <= b.length; j++)
        for (let i = 1; i <= a.length; i++) {
          let cost = 1;
          a[i - 1] === b[j - 1] ? cost = 0 : cost = 1, d[i][j] = Math.min(
            d[i - 1][j] + 1,
            // deletion
            d[i][j - 1] + 1,
            // insertion
            d[i - 1][j - 1] + cost
            // substitution
          ), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && (d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1));
        }
      return d[a.length][b.length];
    }
    function suggestSimilar(word, candidates) {
      if (!candidates || candidates.length === 0) return "";
      candidates = Array.from(new Set(candidates));
      let searchingOptions = word.startsWith("--");
      searchingOptions && (word = word.slice(2), candidates = candidates.map((candidate) => candidate.slice(2)));
      let similar = [], bestDistance = 3, minSimilarity = 0.4;
      return candidates.forEach((candidate) => {
        if (candidate.length <= 1) return;
        let distance = editDistance(word, candidate), length = Math.max(word.length, candidate.length);
        (length - distance) / length > minSimilarity && (distance < bestDistance ? (bestDistance = distance, similar = [candidate]) : distance === bestDistance && similar.push(candidate));
      }), similar.sort((a, b) => a.localeCompare(b)), searchingOptions && (similar = similar.map((candidate) => `--${candidate}`)), similar.length > 1 ? `
(Did you mean one of ${similar.join(", ")}?)` : similar.length === 1 ? `
(Did you mean ${similar[0]}?)` : "";
    }
    exports2.suggestSimilar = suggestSimilar;
  }
});

// ../node_modules/commander/lib/command.js
var require_command = __commonJS({
  "../node_modules/commander/lib/command.js"(exports2) {
    var EventEmitter = require("node:events").EventEmitter, childProcess = require("node:child_process"), path7 = require("node:path"), fs4 = require("node:fs"), process2 = require("node:process"), { Argument: Argument2, humanReadableArgName } = require_argument(), { CommanderError: CommanderError2 } = require_error(), { Help: Help2 } = require_help(), { Option: Option2, DualOptions } = require_option(), { suggestSimilar } = require_suggestSimilar(), Command2 = class _Command extends EventEmitter {
      /**
       * Initialize a new `Command`.
       *
       * @param {string} [name]
       */
      constructor(name) {
        super(), this.commands = [], this.options = [], this.parent = null, this._allowUnknownOption = !1, this._allowExcessArguments = !0, this.registeredArguments = [], this._args = this.registeredArguments, this.args = [], this.rawArgs = [], this.processedArgs = [], this._scriptPath = null, this._name = name || "", this._optionValues = {}, this._optionValueSources = {}, this._storeOptionsAsProperties = !1, this._actionHandler = null, this._executableHandler = !1, this._executableFile = null, this._executableDir = null, this._defaultCommandName = null, this._exitCallback = null, this._aliases = [], this._combineFlagAndOptionalValue = !0, this._description = "", this._summary = "", this._argsDescription = void 0, this._enablePositionalOptions = !1, this._passThroughOptions = !1, this._lifeCycleHooks = {}, this._showHelpAfterError = !1, this._showSuggestionAfterError = !0, this._outputConfiguration = {
          writeOut: (str) => process2.stdout.write(str),
          writeErr: (str) => process2.stderr.write(str),
          getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : void 0,
          getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : void 0,
          outputError: (str, write) => write(str)
        }, this._hidden = !1, this._helpOption = void 0, this._addImplicitHelpCommand = void 0, this._helpCommand = void 0, this._helpConfiguration = {};
      }
      /**
       * Copy settings that are useful to have in common across root command and subcommands.
       *
       * (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
       *
       * @param {Command} sourceCommand
       * @return {Command} `this` command for chaining
       */
      copyInheritedSettings(sourceCommand) {
        return this._outputConfiguration = sourceCommand._outputConfiguration, this._helpOption = sourceCommand._helpOption, this._helpCommand = sourceCommand._helpCommand, this._helpConfiguration = sourceCommand._helpConfiguration, this._exitCallback = sourceCommand._exitCallback, this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties, this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue, this._allowExcessArguments = sourceCommand._allowExcessArguments, this._enablePositionalOptions = sourceCommand._enablePositionalOptions, this._showHelpAfterError = sourceCommand._showHelpAfterError, this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError, this;
      }
      /**
       * @returns {Command[]}
       * @private
       */
      _getCommandAndAncestors() {
        let result = [];
        for (let command = this; command; command = command.parent)
          result.push(command);
        return result;
      }
      /**
       * Define a command.
       *
       * There are two styles of command: pay attention to where to put the description.
       *
       * @example
       * // Command implemented using action handler (description is supplied separately to `.command`)
       * program
       *   .command('clone <source> [destination]')
       *   .description('clone a repository into a newly created directory')
       *   .action((source, destination) => {
       *     console.log('clone command called');
       *   });
       *
       * // Command implemented using separate executable file (description is second parameter to `.command`)
       * program
       *   .command('start <service>', 'start named service')
       *   .command('stop [service]', 'stop named service, or all if no name supplied');
       *
       * @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
       * @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
       * @param {object} [execOpts] - configuration options (for executable)
       * @return {Command} returns new command for action handler, or `this` for executable command
       */
      command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
        let desc = actionOptsOrExecDesc, opts = execOpts;
        typeof desc == "object" && desc !== null && (opts = desc, desc = null), opts = opts || {};
        let [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/), cmd = this.createCommand(name);
        return desc && (cmd.description(desc), cmd._executableHandler = !0), opts.isDefault && (this._defaultCommandName = cmd._name), cmd._hidden = !!(opts.noHelp || opts.hidden), cmd._executableFile = opts.executableFile || null, args && cmd.arguments(args), this._registerCommand(cmd), cmd.parent = this, cmd.copyInheritedSettings(this), desc ? this : cmd;
      }
      /**
       * Factory routine to create a new unattached command.
       *
       * See .command() for creating an attached subcommand, which uses this routine to
       * create the command. You can override createCommand to customise subcommands.
       *
       * @param {string} [name]
       * @return {Command} new command
       */
      createCommand(name) {
        return new _Command(name);
      }
      /**
       * You can customise the help with a subclass of Help by overriding createHelp,
       * or by overriding Help properties using configureHelp().
       *
       * @return {Help}
       */
      createHelp() {
        return Object.assign(new Help2(), this.configureHelp());
      }
      /**
       * You can customise the help by overriding Help properties using configureHelp(),
       * or with a subclass of Help by overriding createHelp().
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureHelp(configuration) {
        return configuration === void 0 ? this._helpConfiguration : (this._helpConfiguration = configuration, this);
      }
      /**
       * The default output goes to stdout and stderr. You can customise this for special
       * applications. You can also customise the display of errors by overriding outputError.
       *
       * The configuration properties are all functions:
       *
       *     // functions to change where being written, stdout and stderr
       *     writeOut(str)
       *     writeErr(str)
       *     // matching functions to specify width for wrapping help
       *     getOutHelpWidth()
       *     getErrHelpWidth()
       *     // functions based on what is being written out
       *     outputError(str, write) // used for displaying errors, and not used for displaying help
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureOutput(configuration) {
        return configuration === void 0 ? this._outputConfiguration : (Object.assign(this._outputConfiguration, configuration), this);
      }
      /**
       * Display the help or a custom message after an error occurs.
       *
       * @param {(boolean|string)} [displayHelp]
       * @return {Command} `this` command for chaining
       */
      showHelpAfterError(displayHelp = !0) {
        return typeof displayHelp != "string" && (displayHelp = !!displayHelp), this._showHelpAfterError = displayHelp, this;
      }
      /**
       * Display suggestion of similar commands for unknown commands, or options for unknown options.
       *
       * @param {boolean} [displaySuggestion]
       * @return {Command} `this` command for chaining
       */
      showSuggestionAfterError(displaySuggestion = !0) {
        return this._showSuggestionAfterError = !!displaySuggestion, this;
      }
      /**
       * Add a prepared subcommand.
       *
       * See .command() for creating an attached subcommand which inherits settings from its parent.
       *
       * @param {Command} cmd - new subcommand
       * @param {object} [opts] - configuration options
       * @return {Command} `this` command for chaining
       */
      addCommand(cmd, opts) {
        if (!cmd._name)
          throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
        return opts = opts || {}, opts.isDefault && (this._defaultCommandName = cmd._name), (opts.noHelp || opts.hidden) && (cmd._hidden = !0), this._registerCommand(cmd), cmd.parent = this, cmd._checkForBrokenPassThrough(), this;
      }
      /**
       * Factory routine to create a new unattached argument.
       *
       * See .argument() for creating an attached argument, which uses this routine to
       * create the argument. You can override createArgument to return a custom argument.
       *
       * @param {string} name
       * @param {string} [description]
       * @return {Argument} new argument
       */
      createArgument(name, description) {
        return new Argument2(name, description);
      }
      /**
       * Define argument syntax for command.
       *
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @example
       * program.argument('<input-file>');
       * program.argument('[output-file]');
       *
       * @param {string} name
       * @param {string} [description]
       * @param {(Function|*)} [fn] - custom argument processing function
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      argument(name, description, fn, defaultValue) {
        let argument = this.createArgument(name, description);
        return typeof fn == "function" ? argument.default(defaultValue).argParser(fn) : argument.default(fn), this.addArgument(argument), this;
      }
      /**
       * Define argument syntax for command, adding multiple at once (without descriptions).
       *
       * See also .argument().
       *
       * @example
       * program.arguments('<cmd> [env]');
       *
       * @param {string} names
       * @return {Command} `this` command for chaining
       */
      arguments(names) {
        return names.trim().split(/ +/).forEach((detail) => {
          this.argument(detail);
        }), this;
      }
      /**
       * Define argument syntax for command, adding a prepared argument.
       *
       * @param {Argument} argument
       * @return {Command} `this` command for chaining
       */
      addArgument(argument) {
        let previousArgument = this.registeredArguments.slice(-1)[0];
        if (previousArgument && previousArgument.variadic)
          throw new Error(
            `only the last argument can be variadic '${previousArgument.name()}'`
          );
        if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0)
          throw new Error(
            `a default value for a required argument is never used: '${argument.name()}'`
          );
        return this.registeredArguments.push(argument), this;
      }
      /**
       * Customise or override default help command. By default a help command is automatically added if your command has subcommands.
       *
       * @example
       *    program.helpCommand('help [cmd]');
       *    program.helpCommand('help [cmd]', 'show help');
       *    program.helpCommand(false); // suppress default help command
       *    program.helpCommand(true); // add help command even if no subcommands
       *
       * @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
       * @param {string} [description] - custom description
       * @return {Command} `this` command for chaining
       */
      helpCommand(enableOrNameAndArgs, description) {
        if (typeof enableOrNameAndArgs == "boolean")
          return this._addImplicitHelpCommand = enableOrNameAndArgs, this;
        enableOrNameAndArgs = enableOrNameAndArgs ?? "help [command]";
        let [, helpName, helpArgs] = enableOrNameAndArgs.match(/([^ ]+) *(.*)/), helpDescription = description ?? "display help for command", helpCommand = this.createCommand(helpName);
        return helpCommand.helpOption(!1), helpArgs && helpCommand.arguments(helpArgs), helpDescription && helpCommand.description(helpDescription), this._addImplicitHelpCommand = !0, this._helpCommand = helpCommand, this;
      }
      /**
       * Add prepared custom help command.
       *
       * @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
       * @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
       * @return {Command} `this` command for chaining
       */
      addHelpCommand(helpCommand, deprecatedDescription) {
        return typeof helpCommand != "object" ? (this.helpCommand(helpCommand, deprecatedDescription), this) : (this._addImplicitHelpCommand = !0, this._helpCommand = helpCommand, this);
      }
      /**
       * Lazy create help command.
       *
       * @return {(Command|null)}
       * @package
       */
      _getHelpCommand() {
        return this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help")) ? (this._helpCommand === void 0 && this.helpCommand(void 0, void 0), this._helpCommand) : null;
      }
      /**
       * Add hook for life cycle event.
       *
       * @param {string} event
       * @param {Function} listener
       * @return {Command} `this` command for chaining
       */
      hook(event, listener) {
        let allowedValues = ["preSubcommand", "preAction", "postAction"];
        if (!allowedValues.includes(event))
          throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
        return this._lifeCycleHooks[event] ? this._lifeCycleHooks[event].push(listener) : this._lifeCycleHooks[event] = [listener], this;
      }
      /**
       * Register callback to use as replacement for calling process.exit.
       *
       * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
       * @return {Command} `this` command for chaining
       */
      exitOverride(fn) {
        return fn ? this._exitCallback = fn : this._exitCallback = (err) => {
          if (err.code !== "commander.executeSubCommandAsync")
            throw err;
        }, this;
      }
      /**
       * Call process.exit, and _exitCallback if defined.
       *
       * @param {number} exitCode exit code for using with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       * @return never
       * @private
       */
      _exit(exitCode, code, message) {
        this._exitCallback && this._exitCallback(new CommanderError2(exitCode, code, message)), process2.exit(exitCode);
      }
      /**
       * Register callback `fn` for the command.
       *
       * @example
       * program
       *   .command('serve')
       *   .description('start service')
       *   .action(function() {
       *      // do work here
       *   });
       *
       * @param {Function} fn
       * @return {Command} `this` command for chaining
       */
      action(fn) {
        let listener = (args) => {
          let expectedArgsCount = this.registeredArguments.length, actionArgs = args.slice(0, expectedArgsCount);
          return this._storeOptionsAsProperties ? actionArgs[expectedArgsCount] = this : actionArgs[expectedArgsCount] = this.opts(), actionArgs.push(this), fn.apply(this, actionArgs);
        };
        return this._actionHandler = listener, this;
      }
      /**
       * Factory routine to create a new unattached option.
       *
       * See .option() for creating an attached option, which uses this routine to
       * create the option. You can override createOption to return a custom option.
       *
       * @param {string} flags
       * @param {string} [description]
       * @return {Option} new option
       */
      createOption(flags, description) {
        return new Option2(flags, description);
      }
      /**
       * Wrap parseArgs to catch 'commander.invalidArgument'.
       *
       * @param {(Option | Argument)} target
       * @param {string} value
       * @param {*} previous
       * @param {string} invalidArgumentMessage
       * @private
       */
      _callParseArg(target, value, previous, invalidArgumentMessage) {
        try {
          return target.parseArg(value, previous);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            let message = `${invalidArgumentMessage} ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      }
      /**
       * Check for option flag conflicts.
       * Register option if no conflicts found, or throw on conflict.
       *
       * @param {Option} option
       * @private
       */
      _registerOption(option) {
        let matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
        if (matchingOption) {
          let matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
          throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
        }
        this.options.push(option);
      }
      /**
       * Check for command name and alias conflicts with existing commands.
       * Register command if no conflicts found, or throw on conflict.
       *
       * @param {Command} command
       * @private
       */
      _registerCommand(command) {
        let knownBy = (cmd) => [cmd.name()].concat(cmd.aliases()), alreadyUsed = knownBy(command).find(
          (name) => this._findCommand(name)
        );
        if (alreadyUsed) {
          let existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|"), newCmd = knownBy(command).join("|");
          throw new Error(
            `cannot add command '${newCmd}' as already have command '${existingCmd}'`
          );
        }
        this.commands.push(command);
      }
      /**
       * Add an option.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addOption(option) {
        this._registerOption(option);
        let oname = option.name(), name = option.attributeName();
        if (option.negate) {
          let positiveLongFlag = option.long.replace(/^--no-/, "--");
          this._findOption(positiveLongFlag) || this.setOptionValueWithSource(
            name,
            option.defaultValue === void 0 ? !0 : option.defaultValue,
            "default"
          );
        } else option.defaultValue !== void 0 && this.setOptionValueWithSource(name, option.defaultValue, "default");
        let handleOptionValue = (val, invalidValueMessage, valueSource) => {
          val == null && option.presetArg !== void 0 && (val = option.presetArg);
          let oldValue = this.getOptionValue(name);
          val !== null && option.parseArg ? val = this._callParseArg(option, val, oldValue, invalidValueMessage) : val !== null && option.variadic && (val = option._concatValue(val, oldValue)), val == null && (option.negate ? val = !1 : option.isBoolean() || option.optional ? val = !0 : val = ""), this.setOptionValueWithSource(name, val, valueSource);
        };
        return this.on("option:" + oname, (val) => {
          let invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "cli");
        }), option.envVar && this.on("optionEnv:" + oname, (val) => {
          let invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "env");
        }), this;
      }
      /**
       * Internal implementation shared by .option() and .requiredOption()
       *
       * @return {Command} `this` command for chaining
       * @private
       */
      _optionEx(config, flags, description, fn, defaultValue) {
        if (typeof flags == "object" && flags instanceof Option2)
          throw new Error(
            "To add an Option object use addOption() instead of option() or requiredOption()"
          );
        let option = this.createOption(flags, description);
        if (option.makeOptionMandatory(!!config.mandatory), typeof fn == "function")
          option.default(defaultValue).argParser(fn);
        else if (fn instanceof RegExp) {
          let regex = fn;
          fn = (val, def) => {
            let m = regex.exec(val);
            return m ? m[0] : def;
          }, option.default(defaultValue).argParser(fn);
        } else
          option.default(fn);
        return this.addOption(option);
      }
      /**
       * Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
       * option-argument is indicated by `<>` and an optional option-argument by `[]`.
       *
       * See the README for more details, and see also addOption() and requiredOption().
       *
       * @example
       * program
       *     .option('-p, --pepper', 'add pepper')
       *     .option('-p, --pizza-type <TYPE>', 'type of pizza') // required option-argument
       *     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
       *     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      option(flags, description, parseArg, defaultValue) {
        return this._optionEx({}, flags, description, parseArg, defaultValue);
      }
      /**
       * Add a required option which must have a value after parsing. This usually means
       * the option must be specified on the command line. (Otherwise the same as .option().)
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      requiredOption(flags, description, parseArg, defaultValue) {
        return this._optionEx(
          { mandatory: !0 },
          flags,
          description,
          parseArg,
          defaultValue
        );
      }
      /**
       * Alter parsing of short flags with optional values.
       *
       * @example
       * // for `.option('-f,--flag [value]'):
       * program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
       * program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
       *
       * @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
       * @return {Command} `this` command for chaining
       */
      combineFlagAndOptionalValue(combine = !0) {
        return this._combineFlagAndOptionalValue = !!combine, this;
      }
      /**
       * Allow unknown options on the command line.
       *
       * @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
       * @return {Command} `this` command for chaining
       */
      allowUnknownOption(allowUnknown = !0) {
        return this._allowUnknownOption = !!allowUnknown, this;
      }
      /**
       * Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
       *
       * @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
       * @return {Command} `this` command for chaining
       */
      allowExcessArguments(allowExcess = !0) {
        return this._allowExcessArguments = !!allowExcess, this;
      }
      /**
       * Enable positional options. Positional means global options are specified before subcommands which lets
       * subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
       * The default behaviour is non-positional and global options may appear anywhere on the command line.
       *
       * @param {boolean} [positional]
       * @return {Command} `this` command for chaining
       */
      enablePositionalOptions(positional = !0) {
        return this._enablePositionalOptions = !!positional, this;
      }
      /**
       * Pass through options that come after command-arguments rather than treat them as command-options,
       * so actual command-options come before command-arguments. Turning this on for a subcommand requires
       * positional options to have been enabled on the program (parent commands).
       * The default behaviour is non-positional and options may appear before or after command-arguments.
       *
       * @param {boolean} [passThrough] for unknown options.
       * @return {Command} `this` command for chaining
       */
      passThroughOptions(passThrough = !0) {
        return this._passThroughOptions = !!passThrough, this._checkForBrokenPassThrough(), this;
      }
      /**
       * @private
       */
      _checkForBrokenPassThrough() {
        if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions)
          throw new Error(
            `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`
          );
      }
      /**
       * Whether to store option values as properties on command object,
       * or store separately (specify false). In both cases the option values can be accessed using .opts().
       *
       * @param {boolean} [storeAsProperties=true]
       * @return {Command} `this` command for chaining
       */
      storeOptionsAsProperties(storeAsProperties = !0) {
        if (this.options.length)
          throw new Error("call .storeOptionsAsProperties() before adding options");
        if (Object.keys(this._optionValues).length)
          throw new Error(
            "call .storeOptionsAsProperties() before setting option values"
          );
        return this._storeOptionsAsProperties = !!storeAsProperties, this;
      }
      /**
       * Retrieve option value.
       *
       * @param {string} key
       * @return {object} value
       */
      getOptionValue(key) {
        return this._storeOptionsAsProperties ? this[key] : this._optionValues[key];
      }
      /**
       * Store option value.
       *
       * @param {string} key
       * @param {object} value
       * @return {Command} `this` command for chaining
       */
      setOptionValue(key, value) {
        return this.setOptionValueWithSource(key, value, void 0);
      }
      /**
       * Store option value and where the value came from.
       *
       * @param {string} key
       * @param {object} value
       * @param {string} source - expected values are default/config/env/cli/implied
       * @return {Command} `this` command for chaining
       */
      setOptionValueWithSource(key, value, source) {
        return this._storeOptionsAsProperties ? this[key] = value : this._optionValues[key] = value, this._optionValueSources[key] = source, this;
      }
      /**
       * Get source of option value.
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSource(key) {
        return this._optionValueSources[key];
      }
      /**
       * Get source of option value. See also .optsWithGlobals().
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSourceWithGlobals(key) {
        let source;
        return this._getCommandAndAncestors().forEach((cmd) => {
          cmd.getOptionValueSource(key) !== void 0 && (source = cmd.getOptionValueSource(key));
        }), source;
      }
      /**
       * Get user arguments from implied or explicit arguments.
       * Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
       *
       * @private
       */
      _prepareUserArgs(argv, parseOptions) {
        if (argv !== void 0 && !Array.isArray(argv))
          throw new Error("first parameter to parse must be array or undefined");
        if (parseOptions = parseOptions || {}, argv === void 0 && parseOptions.from === void 0) {
          process2.versions?.electron && (parseOptions.from = "electron");
          let execArgv = process2.execArgv ?? [];
          (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) && (parseOptions.from = "eval");
        }
        argv === void 0 && (argv = process2.argv), this.rawArgs = argv.slice();
        let userArgs;
        switch (parseOptions.from) {
          case void 0:
          case "node":
            this._scriptPath = argv[1], userArgs = argv.slice(2);
            break;
          case "electron":
            process2.defaultApp ? (this._scriptPath = argv[1], userArgs = argv.slice(2)) : userArgs = argv.slice(1);
            break;
          case "user":
            userArgs = argv.slice(0);
            break;
          case "eval":
            userArgs = argv.slice(1);
            break;
          default:
            throw new Error(
              `unexpected parse option { from: '${parseOptions.from}' }`
            );
        }
        return !this._name && this._scriptPath && this.nameFromFilename(this._scriptPath), this._name = this._name || "program", userArgs;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Use parseAsync instead of parse if any of your action handlers are async.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * program.parse(); // parse process.argv and auto-detect electron and special node flags
       * program.parse(process.argv); // assume argv[0] is app and argv[1] is script
       * program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv] - optional, defaults to process.argv
       * @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
       * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
       * @return {Command} `this` command for chaining
       */
      parse(argv, parseOptions) {
        let userArgs = this._prepareUserArgs(argv, parseOptions);
        return this._parseCommand([], userArgs), this;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
       * await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
       * await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv]
       * @param {object} [parseOptions]
       * @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
       * @return {Promise}
       */
      async parseAsync(argv, parseOptions) {
        let userArgs = this._prepareUserArgs(argv, parseOptions);
        return await this._parseCommand([], userArgs), this;
      }
      /**
       * Execute a sub-command executable.
       *
       * @private
       */
      _executeSubCommand(subcommand, args) {
        args = args.slice();
        let launchWithNode = !1, sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
        function findFile(baseDir, baseName) {
          let localBin = path7.resolve(baseDir, baseName);
          if (fs4.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path7.extname(baseName))) return;
          let foundExt = sourceExt.find(
            (ext) => fs4.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
        }
        this._checkForMissingMandatoryOptions(), this._checkForConflictingOptions();
        let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`, executableDir = this._executableDir || "";
        if (this._scriptPath) {
          let resolvedScriptPath;
          try {
            resolvedScriptPath = fs4.realpathSync(this._scriptPath);
          } catch {
            resolvedScriptPath = this._scriptPath;
          }
          executableDir = path7.resolve(
            path7.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            let legacyName = path7.basename(
              this._scriptPath,
              path7.extname(this._scriptPath)
            );
            legacyName !== this._name && (localFile = findFile(
              executableDir,
              `${legacyName}-${subcommand._name}`
            ));
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path7.extname(executableFile));
        let proc;
        process2.platform !== "win32" ? launchWithNode ? (args.unshift(executableFile), args = incrementNodeInspectorPort(process2.execArgv).concat(args), proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" })) : proc = childProcess.spawn(executableFile, args, { stdio: "inherit" }) : (args.unshift(executableFile), args = incrementNodeInspectorPort(process2.execArgv).concat(args), proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" })), proc.killed || ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"].forEach((signal) => {
          process2.on(signal, () => {
            proc.killed === !1 && proc.exitCode === null && proc.kill(signal);
          });
        });
        let exitCallback = this._exitCallback;
        proc.on("close", (code) => {
          code = code ?? 1, exitCallback ? exitCallback(
            new CommanderError2(
              code,
              "commander.executeSubCommandAsync",
              "(close)"
            )
          ) : process2.exit(code);
        }), proc.on("error", (err) => {
          if (err.code === "ENOENT") {
            let executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory", executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
            throw new Error(executableMissing);
          } else if (err.code === "EACCES")
            throw new Error(`'${executableFile}' not executable`);
          if (!exitCallback)
            process2.exit(1);
          else {
            let wrappedError = new CommanderError2(
              1,
              "commander.executeSubCommandAsync",
              "(error)"
            );
            wrappedError.nestedError = err, exitCallback(wrappedError);
          }
        }), this.runningCommand = proc;
      }
      /**
       * @private
       */
      _dispatchSubcommand(commandName, operands, unknown) {
        let subCommand = this._findCommand(commandName);
        subCommand || this.help({ error: !0 });
        let promiseChain;
        return promiseChain = this._chainOrCallSubCommandHook(
          promiseChain,
          subCommand,
          "preSubcommand"
        ), promiseChain = this._chainOrCall(promiseChain, () => {
          if (subCommand._executableHandler)
            this._executeSubCommand(subCommand, operands.concat(unknown));
          else
            return subCommand._parseCommand(operands, unknown);
        }), promiseChain;
      }
      /**
       * Invoke help directly if possible, or dispatch if necessary.
       * e.g. help foo
       *
       * @private
       */
      _dispatchHelpCommand(subcommandName) {
        subcommandName || this.help();
        let subCommand = this._findCommand(subcommandName);
        return subCommand && !subCommand._executableHandler && subCommand.help(), this._dispatchSubcommand(
          subcommandName,
          [],
          [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]
        );
      }
      /**
       * Check this.args against expected this.registeredArguments.
       *
       * @private
       */
      _checkNumberOfArguments() {
        this.registeredArguments.forEach((arg, i) => {
          arg.required && this.args[i] == null && this.missingArgument(arg.name());
        }), !(this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) && this.args.length > this.registeredArguments.length && this._excessArguments(this.args);
      }
      /**
       * Process this.args using this.registeredArguments and save as this.processedArgs!
       *
       * @private
       */
      _processArguments() {
        let myParseArg = (argument, value, previous) => {
          let parsedValue = value;
          if (value !== null && argument.parseArg) {
            let invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
            parsedValue = this._callParseArg(
              argument,
              value,
              previous,
              invalidValueMessage
            );
          }
          return parsedValue;
        };
        this._checkNumberOfArguments();
        let processedArgs = [];
        this.registeredArguments.forEach((declaredArg, index) => {
          let value = declaredArg.defaultValue;
          declaredArg.variadic ? index < this.args.length ? (value = this.args.slice(index), declaredArg.parseArg && (value = value.reduce((processed, v) => myParseArg(declaredArg, v, processed), declaredArg.defaultValue))) : value === void 0 && (value = []) : index < this.args.length && (value = this.args[index], declaredArg.parseArg && (value = myParseArg(declaredArg, value, declaredArg.defaultValue))), processedArgs[index] = value;
        }), this.processedArgs = processedArgs;
      }
      /**
       * Once we have a promise we chain, but call synchronously until then.
       *
       * @param {(Promise|undefined)} promise
       * @param {Function} fn
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCall(promise, fn) {
        return promise && promise.then && typeof promise.then == "function" ? promise.then(() => fn()) : fn();
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallHooks(promise, event) {
        let result = promise, hooks = [];
        return this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
          hookedCommand._lifeCycleHooks[event].forEach((callback) => {
            hooks.push({ hookedCommand, callback });
          });
        }), event === "postAction" && hooks.reverse(), hooks.forEach((hookDetail) => {
          result = this._chainOrCall(result, () => hookDetail.callback(hookDetail.hookedCommand, this));
        }), result;
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {Command} subCommand
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallSubCommandHook(promise, subCommand, event) {
        let result = promise;
        return this._lifeCycleHooks[event] !== void 0 && this._lifeCycleHooks[event].forEach((hook) => {
          result = this._chainOrCall(result, () => hook(this, subCommand));
        }), result;
      }
      /**
       * Process arguments in context of this command.
       * Returns action result, in case it is a promise.
       *
       * @private
       */
      _parseCommand(operands, unknown) {
        let parsed = this.parseOptions(unknown);
        if (this._parseOptionsEnv(), this._parseOptionsImplied(), operands = operands.concat(parsed.operands), unknown = parsed.unknown, this.args = operands.concat(unknown), operands && this._findCommand(operands[0]))
          return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
        if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name())
          return this._dispatchHelpCommand(operands[1]);
        if (this._defaultCommandName)
          return this._outputHelpIfRequested(unknown), this._dispatchSubcommand(
            this._defaultCommandName,
            operands,
            unknown
          );
        this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName && this.help({ error: !0 }), this._outputHelpIfRequested(parsed.unknown), this._checkForMissingMandatoryOptions(), this._checkForConflictingOptions();
        let checkForUnknownOptions = () => {
          parsed.unknown.length > 0 && this.unknownOption(parsed.unknown[0]);
        }, commandEvent = `command:${this.name()}`;
        if (this._actionHandler) {
          checkForUnknownOptions(), this._processArguments();
          let promiseChain;
          return promiseChain = this._chainOrCallHooks(promiseChain, "preAction"), promiseChain = this._chainOrCall(
            promiseChain,
            () => this._actionHandler(this.processedArgs)
          ), this.parent && (promiseChain = this._chainOrCall(promiseChain, () => {
            this.parent.emit(commandEvent, operands, unknown);
          })), promiseChain = this._chainOrCallHooks(promiseChain, "postAction"), promiseChain;
        }
        if (this.parent && this.parent.listenerCount(commandEvent))
          checkForUnknownOptions(), this._processArguments(), this.parent.emit(commandEvent, operands, unknown);
        else if (operands.length) {
          if (this._findCommand("*"))
            return this._dispatchSubcommand("*", operands, unknown);
          this.listenerCount("command:*") ? this.emit("command:*", operands, unknown) : this.commands.length ? this.unknownCommand() : (checkForUnknownOptions(), this._processArguments());
        } else this.commands.length ? (checkForUnknownOptions(), this.help({ error: !0 })) : (checkForUnknownOptions(), this._processArguments());
      }
      /**
       * Find matching command.
       *
       * @private
       * @return {Command | undefined}
       */
      _findCommand(name) {
        if (name)
          return this.commands.find(
            (cmd) => cmd._name === name || cmd._aliases.includes(name)
          );
      }
      /**
       * Return an option matching `arg` if any.
       *
       * @param {string} arg
       * @return {Option}
       * @package
       */
      _findOption(arg) {
        return this.options.find((option) => option.is(arg));
      }
      /**
       * Display an error message if a mandatory option does not have a value.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForMissingMandatoryOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd.options.forEach((anOption) => {
            anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0 && cmd.missingMandatoryOptionValue(anOption);
          });
        });
      }
      /**
       * Display an error message if conflicting options are used together in this.
       *
       * @private
       */
      _checkForConflictingLocalOptions() {
        let definedNonDefaultOptions = this.options.filter((option) => {
          let optionKey = option.attributeName();
          return this.getOptionValue(optionKey) === void 0 ? !1 : this.getOptionValueSource(optionKey) !== "default";
        });
        definedNonDefaultOptions.filter(
          (option) => option.conflictsWith.length > 0
        ).forEach((option) => {
          let conflictingAndDefined = definedNonDefaultOptions.find(
            (defined) => option.conflictsWith.includes(defined.attributeName())
          );
          conflictingAndDefined && this._conflictingOption(option, conflictingAndDefined);
        });
      }
      /**
       * Display an error message if conflicting options are used together.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForConflictingOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd._checkForConflictingLocalOptions();
        });
      }
      /**
       * Parse options from `argv` removing known options,
       * and return argv split into operands and unknown arguments.
       *
       * Examples:
       *
       *     argv => operands, unknown
       *     --known kkk op => [op], []
       *     op --known kkk => [op], []
       *     sub --unknown uuu op => [sub], [--unknown uuu op]
       *     sub -- --unknown uuu op => [sub --unknown uuu op], []
       *
       * @param {string[]} argv
       * @return {{operands: string[], unknown: string[]}}
       */
      parseOptions(argv) {
        let operands = [], unknown = [], dest = operands, args = argv.slice();
        function maybeOption(arg) {
          return arg.length > 1 && arg[0] === "-";
        }
        let activeVariadicOption = null;
        for (; args.length; ) {
          let arg = args.shift();
          if (arg === "--") {
            dest === unknown && dest.push(arg), dest.push(...args);
            break;
          }
          if (activeVariadicOption && !maybeOption(arg)) {
            this.emit(`option:${activeVariadicOption.name()}`, arg);
            continue;
          }
          if (activeVariadicOption = null, maybeOption(arg)) {
            let option = this._findOption(arg);
            if (option) {
              if (option.required) {
                let value = args.shift();
                value === void 0 && this.optionMissingArgument(option), this.emit(`option:${option.name()}`, value);
              } else if (option.optional) {
                let value = null;
                args.length > 0 && !maybeOption(args[0]) && (value = args.shift()), this.emit(`option:${option.name()}`, value);
              } else
                this.emit(`option:${option.name()}`);
              activeVariadicOption = option.variadic ? option : null;
              continue;
            }
          }
          if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
            let option = this._findOption(`-${arg[1]}`);
            if (option) {
              option.required || option.optional && this._combineFlagAndOptionalValue ? this.emit(`option:${option.name()}`, arg.slice(2)) : (this.emit(`option:${option.name()}`), args.unshift(`-${arg.slice(2)}`));
              continue;
            }
          }
          if (/^--[^=]+=/.test(arg)) {
            let index = arg.indexOf("="), option = this._findOption(arg.slice(0, index));
            if (option && (option.required || option.optional)) {
              this.emit(`option:${option.name()}`, arg.slice(index + 1));
              continue;
            }
          }
          if (maybeOption(arg) && (dest = unknown), (this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
            if (this._findCommand(arg)) {
              operands.push(arg), args.length > 0 && unknown.push(...args);
              break;
            } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
              operands.push(arg), args.length > 0 && operands.push(...args);
              break;
            } else if (this._defaultCommandName) {
              unknown.push(arg), args.length > 0 && unknown.push(...args);
              break;
            }
          }
          if (this._passThroughOptions) {
            dest.push(arg), args.length > 0 && dest.push(...args);
            break;
          }
          dest.push(arg);
        }
        return { operands, unknown };
      }
      /**
       * Return an object containing local option values as key-value pairs.
       *
       * @return {object}
       */
      opts() {
        if (this._storeOptionsAsProperties) {
          let result = {}, len = this.options.length;
          for (let i = 0; i < len; i++) {
            let key = this.options[i].attributeName();
            result[key] = key === this._versionOptionName ? this._version : this[key];
          }
          return result;
        }
        return this._optionValues;
      }
      /**
       * Return an object containing merged local and global option values as key-value pairs.
       *
       * @return {object}
       */
      optsWithGlobals() {
        return this._getCommandAndAncestors().reduce(
          (combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()),
          {}
        );
      }
      /**
       * Display error message and exit (or call exitOverride).
       *
       * @param {string} message
       * @param {object} [errorOptions]
       * @param {string} [errorOptions.code] - an id string representing the error
       * @param {number} [errorOptions.exitCode] - used with process.exit
       */
      error(message, errorOptions) {
        this._outputConfiguration.outputError(
          `${message}
`,
          this._outputConfiguration.writeErr
        ), typeof this._showHelpAfterError == "string" ? this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`) : this._showHelpAfterError && (this._outputConfiguration.writeErr(`
`), this.outputHelp({ error: !0 }));
        let config = errorOptions || {}, exitCode = config.exitCode || 1, code = config.code || "commander.error";
        this._exit(exitCode, code, message);
      }
      /**
       * Apply any option related environment variables, if option does
       * not have a value from cli or client code.
       *
       * @private
       */
      _parseOptionsEnv() {
        this.options.forEach((option) => {
          if (option.envVar && option.envVar in process2.env) {
            let optionKey = option.attributeName();
            (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(
              this.getOptionValueSource(optionKey)
            )) && (option.required || option.optional ? this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]) : this.emit(`optionEnv:${option.name()}`));
          }
        });
      }
      /**
       * Apply any implied option values, if option is undefined or default value.
       *
       * @private
       */
      _parseOptionsImplied() {
        let dualHelper = new DualOptions(this.options), hasCustomOptionValue = (optionKey) => this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
        this.options.filter(
          (option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(
            this.getOptionValue(option.attributeName()),
            option
          )
        ).forEach((option) => {
          Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
            this.setOptionValueWithSource(
              impliedKey,
              option.implied[impliedKey],
              "implied"
            );
          });
        });
      }
      /**
       * Argument `name` is missing.
       *
       * @param {string} name
       * @private
       */
      missingArgument(name) {
        let message = `error: missing required argument '${name}'`;
        this.error(message, { code: "commander.missingArgument" });
      }
      /**
       * `Option` is missing an argument.
       *
       * @param {Option} option
       * @private
       */
      optionMissingArgument(option) {
        let message = `error: option '${option.flags}' argument missing`;
        this.error(message, { code: "commander.optionMissingArgument" });
      }
      /**
       * `Option` does not have a value, and is a mandatory option.
       *
       * @param {Option} option
       * @private
       */
      missingMandatoryOptionValue(option) {
        let message = `error: required option '${option.flags}' not specified`;
        this.error(message, { code: "commander.missingMandatoryOptionValue" });
      }
      /**
       * `Option` conflicts with another option.
       *
       * @param {Option} option
       * @param {Option} conflictingOption
       * @private
       */
      _conflictingOption(option, conflictingOption) {
        let findBestOptionFromValue = (option2) => {
          let optionKey = option2.attributeName(), optionValue = this.getOptionValue(optionKey), negativeOption = this.options.find(
            (target) => target.negate && optionKey === target.attributeName()
          ), positiveOption = this.options.find(
            (target) => !target.negate && optionKey === target.attributeName()
          );
          return negativeOption && (negativeOption.presetArg === void 0 && optionValue === !1 || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg) ? negativeOption : positiveOption || option2;
        }, getErrorMessage = (option2) => {
          let bestOption = findBestOptionFromValue(option2), optionKey = bestOption.attributeName();
          return this.getOptionValueSource(optionKey) === "env" ? `environment variable '${bestOption.envVar}'` : `option '${bestOption.flags}'`;
        }, message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
        this.error(message, { code: "commander.conflictingOption" });
      }
      /**
       * Unknown option `flag`.
       *
       * @param {string} flag
       * @private
       */
      unknownOption(flag) {
        if (this._allowUnknownOption) return;
        let suggestion = "";
        if (flag.startsWith("--") && this._showSuggestionAfterError) {
          let candidateFlags = [], command = this;
          do {
            let moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
            candidateFlags = candidateFlags.concat(moreFlags), command = command.parent;
          } while (command && !command._enablePositionalOptions);
          suggestion = suggestSimilar(flag, candidateFlags);
        }
        let message = `error: unknown option '${flag}'${suggestion}`;
        this.error(message, { code: "commander.unknownOption" });
      }
      /**
       * Excess arguments, more than expected.
       *
       * @param {string[]} receivedArgs
       * @private
       */
      _excessArguments(receivedArgs) {
        if (this._allowExcessArguments) return;
        let expected = this.registeredArguments.length, s = expected === 1 ? "" : "s", message = `error: too many arguments${this.parent ? ` for '${this.name()}'` : ""}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
        this.error(message, { code: "commander.excessArguments" });
      }
      /**
       * Unknown command.
       *
       * @private
       */
      unknownCommand() {
        let unknownName = this.args[0], suggestion = "";
        if (this._showSuggestionAfterError) {
          let candidateNames = [];
          this.createHelp().visibleCommands(this).forEach((command) => {
            candidateNames.push(command.name()), command.alias() && candidateNames.push(command.alias());
          }), suggestion = suggestSimilar(unknownName, candidateNames);
        }
        let message = `error: unknown command '${unknownName}'${suggestion}`;
        this.error(message, { code: "commander.unknownCommand" });
      }
      /**
       * Get or set the program version.
       *
       * This method auto-registers the "-V, --version" option which will print the version number.
       *
       * You can optionally supply the flags and description to override the defaults.
       *
       * @param {string} [str]
       * @param {string} [flags]
       * @param {string} [description]
       * @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
       */
      version(str, flags, description) {
        if (str === void 0) return this._version;
        this._version = str, flags = flags || "-V, --version", description = description || "output the version number";
        let versionOption = this.createOption(flags, description);
        return this._versionOptionName = versionOption.attributeName(), this._registerOption(versionOption), this.on("option:" + versionOption.name(), () => {
          this._outputConfiguration.writeOut(`${str}
`), this._exit(0, "commander.version", str);
        }), this;
      }
      /**
       * Set the description.
       *
       * @param {string} [str]
       * @param {object} [argsDescription]
       * @return {(string|Command)}
       */
      description(str, argsDescription) {
        return str === void 0 && argsDescription === void 0 ? this._description : (this._description = str, argsDescription && (this._argsDescription = argsDescription), this);
      }
      /**
       * Set the summary. Used when listed as subcommand of parent.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      summary(str) {
        return str === void 0 ? this._summary : (this._summary = str, this);
      }
      /**
       * Set an alias for the command.
       *
       * You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
       *
       * @param {string} [alias]
       * @return {(string|Command)}
       */
      alias(alias) {
        if (alias === void 0) return this._aliases[0];
        let command = this;
        if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler && (command = this.commands[this.commands.length - 1]), alias === command._name)
          throw new Error("Command alias can't be the same as its name");
        let matchingCommand = this.parent?._findCommand(alias);
        if (matchingCommand) {
          let existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
          throw new Error(
            `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`
          );
        }
        return command._aliases.push(alias), this;
      }
      /**
       * Set aliases for the command.
       *
       * Only the first alias is shown in the auto-generated help.
       *
       * @param {string[]} [aliases]
       * @return {(string[]|Command)}
       */
      aliases(aliases) {
        return aliases === void 0 ? this._aliases : (aliases.forEach((alias) => this.alias(alias)), this);
      }
      /**
       * Set / get the command usage `str`.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      usage(str) {
        if (str === void 0) {
          if (this._usage) return this._usage;
          let args = this.registeredArguments.map((arg) => humanReadableArgName(arg));
          return [].concat(
            this.options.length || this._helpOption !== null ? "[options]" : [],
            this.commands.length ? "[command]" : [],
            this.registeredArguments.length ? args : []
          ).join(" ");
        }
        return this._usage = str, this;
      }
      /**
       * Get or set the name of the command.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      name(str) {
        return str === void 0 ? this._name : (this._name = str, this);
      }
      /**
       * Set the name of the command from script filename, such as process.argv[1],
       * or require.main.filename, or __filename.
       *
       * (Used internally and public although not documented in README.)
       *
       * @example
       * program.nameFromFilename(require.main.filename);
       *
       * @param {string} filename
       * @return {Command}
       */
      nameFromFilename(filename) {
        return this._name = path7.basename(filename, path7.extname(filename)), this;
      }
      /**
       * Get or set the directory for searching for executable subcommands of this command.
       *
       * @example
       * program.executableDir(__dirname);
       * // or
       * program.executableDir('subcommands');
       *
       * @param {string} [path]
       * @return {(string|null|Command)}
       */
      executableDir(path8) {
        return path8 === void 0 ? this._executableDir : (this._executableDir = path8, this);
      }
      /**
       * Return program help documentation.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
       * @return {string}
       */
      helpInformation(contextOptions) {
        let helper = this.createHelp();
        return helper.helpWidth === void 0 && (helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth()), helper.formatHelp(this, helper);
      }
      /**
       * @private
       */
      _getHelpContext(contextOptions) {
        contextOptions = contextOptions || {};
        let context = { error: !!contextOptions.error }, write;
        return context.error ? write = (arg) => this._outputConfiguration.writeErr(arg) : write = (arg) => this._outputConfiguration.writeOut(arg), context.write = contextOptions.write || write, context.command = this, context;
      }
      /**
       * Output help information for this command.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      outputHelp(contextOptions) {
        let deprecatedCallback;
        typeof contextOptions == "function" && (deprecatedCallback = contextOptions, contextOptions = void 0);
        let context = this._getHelpContext(contextOptions);
        this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", context)), this.emit("beforeHelp", context);
        let helpInformation = this.helpInformation(context);
        if (deprecatedCallback && (helpInformation = deprecatedCallback(helpInformation), typeof helpInformation != "string" && !Buffer.isBuffer(helpInformation)))
          throw new Error("outputHelp callback must return a string or a Buffer");
        context.write(helpInformation), this._getHelpOption()?.long && this.emit(this._getHelpOption().long), this.emit("afterHelp", context), this._getCommandAndAncestors().forEach(
          (command) => command.emit("afterAllHelp", context)
        );
      }
      /**
       * You can pass in flags and a description to customise the built-in help option.
       * Pass in false to disable the built-in help option.
       *
       * @example
       * program.helpOption('-?, --help' 'show help'); // customise
       * program.helpOption(false); // disable
       *
       * @param {(string | boolean)} flags
       * @param {string} [description]
       * @return {Command} `this` command for chaining
       */
      helpOption(flags, description) {
        return typeof flags == "boolean" ? (flags ? this._helpOption = this._helpOption ?? void 0 : this._helpOption = null, this) : (flags = flags ?? "-h, --help", description = description ?? "display help for command", this._helpOption = this.createOption(flags, description), this);
      }
      /**
       * Lazy create help option.
       * Returns null if has been disabled with .helpOption(false).
       *
       * @returns {(Option | null)} the help option
       * @package
       */
      _getHelpOption() {
        return this._helpOption === void 0 && this.helpOption(void 0, void 0), this._helpOption;
      }
      /**
       * Supply your own option to use for the built-in help option.
       * This is an alternative to using helpOption() to customise the flags and description etc.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addHelpOption(option) {
        return this._helpOption = option, this;
      }
      /**
       * Output help information and exit.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      help(contextOptions) {
        this.outputHelp(contextOptions);
        let exitCode = process2.exitCode || 0;
        exitCode === 0 && contextOptions && typeof contextOptions != "function" && contextOptions.error && (exitCode = 1), this._exit(exitCode, "commander.help", "(outputHelp)");
      }
      /**
       * Add additional text to be displayed with the built-in help.
       *
       * Position is 'before' or 'after' to affect just this command,
       * and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
       *
       * @param {string} position - before or after built-in help
       * @param {(string | Function)} text - string to add, or a function returning a string
       * @return {Command} `this` command for chaining
       */
      addHelpText(position, text) {
        let allowedValues = ["beforeAll", "before", "after", "afterAll"];
        if (!allowedValues.includes(position))
          throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
        let helpEvent = `${position}Help`;
        return this.on(helpEvent, (context) => {
          let helpStr;
          typeof text == "function" ? helpStr = text({ error: context.error, command: context.command }) : helpStr = text, helpStr && context.write(`${helpStr}
`);
        }), this;
      }
      /**
       * Output help information if help flags specified
       *
       * @param {Array} args - array of options to search for help flags
       * @private
       */
      _outputHelpIfRequested(args) {
        let helpOption = this._getHelpOption();
        helpOption && args.find((arg) => helpOption.is(arg)) && (this.outputHelp(), this._exit(0, "commander.helpDisplayed", "(outputHelp)"));
      }
    };
    function incrementNodeInspectorPort(args) {
      return args.map((arg) => {
        if (!arg.startsWith("--inspect"))
          return arg;
        let debugOption, debugHost = "127.0.0.1", debugPort = "9229", match;
        return (match = arg.match(/^(--inspect(-brk)?)$/)) !== null ? debugOption = match[1] : (match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null ? (debugOption = match[1], /^\d+$/.test(match[3]) ? debugPort = match[3] : debugHost = match[3]) : (match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null && (debugOption = match[1], debugHost = match[3], debugPort = match[4]), debugOption && debugPort !== "0" ? `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}` : arg;
      });
    }
    exports2.Command = Command2;
  }
});

// ../node_modules/commander/index.js
var require_commander = __commonJS({
  "../node_modules/commander/index.js"(exports2) {
    var { Argument: Argument2 } = require_argument(), { Command: Command2 } = require_command(), { CommanderError: CommanderError2, InvalidArgumentError: InvalidArgumentError2 } = require_error(), { Help: Help2 } = require_help(), { Option: Option2 } = require_option();
    exports2.program = new Command2();
    exports2.createCommand = (name) => new Command2(name);
    exports2.createOption = (flags, description) => new Option2(flags, description);
    exports2.createArgument = (name, description) => new Argument2(name, description);
    exports2.Command = Command2;
    exports2.Option = Option2;
    exports2.Argument = Argument2;
    exports2.Help = Help2;
    exports2.CommanderError = CommanderError2;
    exports2.InvalidArgumentError = InvalidArgumentError2;
    exports2.InvalidOptionArgumentError = InvalidArgumentError2;
  }
});

// ../node_modules/commander/esm.mjs
var import_index = __toESM(require_commander(), 1), {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = import_index.default;

// src/index.ts
var path6 = __toESM(require("node:path"));

// src/paths.ts
var os = __toESM(require("node:os")), path = __toESM(require("node:path")), fs = __toESM(require("node:fs")), CONFIG_DIR = path.join(os.homedir(), ".vibehub"), CONFIG_PATH = path.join(CONFIG_DIR, "config.json"), STATUS_PATH = path.join(CONFIG_DIR, "status.json"), QUEUE_PATH = path.join(CONFIG_DIR, "queue.json"), PID_PATH = path.join(CONFIG_DIR, "tracker.pid"), LOG_PATH = path.join(CONFIG_DIR, "daemon.log");
function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: !0, mode: 448 });
  try {
    fs.chmodSync(CONFIG_DIR, 448);
  } catch {
  }
}
function writeJsonAtomic(filePath, data) {
  ensureConfigDir();
  let dir = path.dirname(filePath), tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 384 }), fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 384);
  } catch {
  }
}
function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}
function readJson(filePath) {
  try {
    let raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return err && err.code === "ENOENT", null;
  }
}

// src/config.ts
var DEFAULT_API_URL = process.env.VIBEHUB_API_URL ?? "https://server-production-cc06.up.railway.app", DEFAULT_HEARTBEAT_INTERVAL_MS = 3e4, DEFAULT_IDLE_THRESHOLD_MS = 3e5;
function readConfig() {
  return readJson(CONFIG_PATH);
}
function requireConfig() {
  let config = readConfig();
  return config || (console.error(
    "Not logged in. Run `vibehub-tracker login <deviceToken>` first."
  ), process.exit(1)), config;
}
function writeConfig(config) {
  writeJsonAtomic(CONFIG_PATH, config);
}
function deleteConfig() {
  removeFile(CONFIG_PATH);
}
function heartbeatIntervalMs(config) {
  return config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
}
function idleThresholdMs(config) {
  return config.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
}

// src/daemon.ts
var import_node_child_process2 = require("node:child_process"), fs3 = __toESM(require("node:fs"));

// src/adapters/claudeCode.ts
var import_node_os = __toESM(require("node:os")), import_node_path2 = __toESM(require("node:path"));

// src/adapters/jsonlTail.ts
var import_node_fs = __toESM(require("node:fs")), import_node_path = __toESM(require("node:path")), JsonlTailer = class {
  offsets = /* @__PURE__ */ new Map();
  partial = /* @__PURE__ */ new Map();
  recentFiles(root, maxAgeMs) {
    let out = [];
    if (!import_node_fs.default.existsSync(root)) return out;
    let cutoff = Date.now() - maxAgeMs, visit = (dir, depth) => {
      let entries;
      try {
        entries = import_node_fs.default.readdirSync(dir, { withFileTypes: !0 });
      } catch {
        return;
      }
      for (let e of entries) {
        let full = import_node_path.default.join(dir, e.name);
        if (e.isDirectory())
          depth < 4 && visit(full, depth + 1);
        else if (e.isFile() && e.name.endsWith(".jsonl"))
          try {
            import_node_fs.default.statSync(full).mtimeMs >= cutoff && out.push(full);
          } catch {
          }
      }
    };
    return visit(root, 0), out;
  }
  readNewLines(file) {
    let size;
    try {
      size = import_node_fs.default.statSync(file).size;
    } catch {
      return [];
    }
    let known = this.offsets.get(file);
    if (known === void 0)
      return this.offsets.set(file, size), [];
    if (size < known)
      return this.offsets.set(file, 0), this.partial.delete(file), this.readNewLines(file);
    if (size === known) return [];
    let length = size - known, buf = Buffer.alloc(length), fd = null;
    try {
      fd = import_node_fs.default.openSync(file, "r"), import_node_fs.default.readSync(fd, buf, 0, length, known);
    } catch {
      return [];
    } finally {
      fd !== null && import_node_fs.default.closeSync(fd);
    }
    this.offsets.set(file, size);
    let lines = ((this.partial.get(file) ?? "") + buf.toString("utf8")).split(`
`);
    this.partial.set(file, lines.pop() ?? "");
    let parsed = [];
    for (let line of lines) {
      let trimmed = line.trim();
      if (trimmed)
        try {
          parsed.push(JSON.parse(trimmed));
        } catch {
        }
    }
    return parsed;
  }
  mtime(file) {
    try {
      return import_node_fs.default.statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  }
}, RecentIds = class {
  constructor(max = 2e3) {
    this.max = max;
  }
  max;
  ids = /* @__PURE__ */ new Set();
  order = [];
  /** Returns true if the id was new. */
  add(id) {
    if (this.ids.has(id)) return !1;
    if (this.ids.add(id), this.order.push(id), this.order.length > this.max) {
      let oldest = this.order.shift();
      oldest && this.ids.delete(oldest);
    }
    return !0;
  }
};

// src/adapters/claudeCode.ts
var ClaudeCodeAdapter = class {
  constructor(recentWindowMs) {
    this.recentWindowMs = recentWindowMs;
    let configDir = process.env.CLAUDE_CONFIG_DIR || import_node_path2.default.join(import_node_os.default.homedir(), ".claude");
    this.roots = [import_node_path2.default.join(configDir, "projects")];
  }
  recentWindowMs;
  name = "claude-code";
  tailer = new JsonlTailer();
  seen = new RecentIds();
  roots;
  /** Last known cwd/model per file, so activity without usage still resolves a project. */
  fileMeta = /* @__PURE__ */ new Map();
  async poll() {
    let byFile = /* @__PURE__ */ new Map();
    for (let root of this.roots)
      for (let file of this.tailer.recentFiles(root, this.recentWindowMs)) {
        let mtime = this.tailer.mtime(file), meta = this.fileMeta.get(file) ?? { cwd: null, model: null }, input = 0, output = 0, lastTs = 0;
        for (let raw of this.tailer.readNewLines(file)) {
          let line = raw;
          line.cwd && (meta.cwd = line.cwd);
          let ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
          if (Number.isNaN(ts) || (lastTs = Math.max(lastTs, ts)), line.type !== "assistant" || !line.message) continue;
          line.message.model && (meta.model = line.message.model);
          let id = line.message.id, usage = line.message.usage;
          !usage || !id || !this.seen.add(id) || (input += (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), output += usage.output_tokens ?? 0);
        }
        this.fileMeta.set(file, meta), byFile.set(file, {
          tool: this.name,
          cwd: meta.cwd,
          projectHint: meta.cwd ? null : projectFromSlug(root, file),
          model: meta.model,
          // mtime is the freshest signal (user prompts don't carry usage but do touch the file).
          lastActivityAt: Math.max(mtime, lastTs),
          tokensInputDelta: input,
          tokensOutputDelta: output,
          confidence: "activity"
        });
      }
    return [...byFile.values()];
  }
};
function projectFromSlug(root, file) {
  let rel = import_node_path2.default.relative(root, file).split(import_node_path2.default.sep)[0];
  if (!rel) return null;
  let parts = rel.split("-").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

// src/adapters/codex.ts
var import_node_os2 = __toESM(require("node:os")), import_node_path3 = __toESM(require("node:path"));
var CodexAdapter = class {
  constructor(recentWindowMs) {
    this.recentWindowMs = recentWindowMs;
    let home = process.env.CODEX_HOME || import_node_path3.default.join(import_node_os2.default.homedir(), ".codex");
    this.root = import_node_path3.default.join(home, "sessions");
  }
  recentWindowMs;
  name = "codex";
  tailer = new JsonlTailer();
  root;
  fileMeta = /* @__PURE__ */ new Map();
  async poll() {
    let out = [];
    for (let file of this.tailer.recentFiles(this.root, this.recentWindowMs)) {
      let meta = this.fileMeta.get(file) ?? { cwd: null, model: null, totalIn: -1, totalOut: -1 }, input = 0, output = 0, lastTs = 0;
      for (let raw of this.tailer.readNewLines(file)) {
        let line = raw, ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
        Number.isNaN(ts) || (lastTs = Math.max(lastTs, ts));
        let p = line.payload;
        if (p && (p.cwd && (meta.cwd = p.cwd), p.model && (meta.model = p.model), line.type === "event_msg" && p.type === "token_count" && p.info)) {
          let total = p.info.total_token_usage;
          if (total) {
            let tin = (total.input_tokens ?? 0) + (total.cached_input_tokens ?? 0), tout = total.output_tokens ?? 0;
            if (meta.totalIn >= 0)
              input += Math.max(0, tin - meta.totalIn), output += Math.max(0, tout - meta.totalOut);
            else if (p.info.last_token_usage) {
              let last = p.info.last_token_usage;
              input += (last.input_tokens ?? 0) + (last.cached_input_tokens ?? 0), output += last.output_tokens ?? 0;
            }
            meta.totalIn = tin, meta.totalOut = tout;
          }
        }
      }
      this.fileMeta.set(file, meta), out.push({
        tool: this.name,
        cwd: meta.cwd,
        projectHint: null,
        model: meta.model,
        lastActivityAt: Math.max(this.tailer.mtime(file), lastTs),
        tokensInputDelta: input,
        tokensOutputDelta: output,
        confidence: "activity"
      });
    }
    return out;
  }
};

// src/adapters/processes.ts
var import_node_child_process = require("node:child_process"), import_node_util = require("node:util"), exec = (0, import_node_util.promisify)(import_node_child_process.execFile), RULES = [
  { tool: "cursor", names: ["cursor"], titleSuffixes: ["cursor"] },
  { tool: "vscode", names: ["code", "code - insiders"], titleSuffixes: ["visual studio code", "visual studio code - insiders"] },
  { tool: "windsurf", names: ["windsurf"], titleSuffixes: ["windsurf"] },
  { tool: "zed", names: ["zed"], titleSuffixes: ["zed"] },
  { tool: "quadcode", names: ["genui", "quadcode", "quadcode ai"], titleSuffixes: ["quadcode ai"] },
  { tool: "claude-code", names: ["claude"], titleSuffixes: [], logBacked: !0 },
  { tool: "codex", names: ["codex"], titleSuffixes: [], logBacked: !0 },
  { tool: "chatgpt", names: ["chatgpt"], titleSuffixes: ["chatgpt"] }
], ProcessAdapter = class {
  constructor(idleAfterMs) {
    this.idleAfterMs = idleAfterMs;
  }
  idleAfterMs;
  name = "processes";
  seen = /* @__PURE__ */ new Map();
  async poll() {
    try {
      let procs = process.platform === "win32" ? await listWindows() : await listUnix(), now = Date.now(), out = /* @__PURE__ */ new Map();
      for (let rule of RULES) {
        let matches = procs.filter((p) => rule.names.includes(p.name));
        if (matches.length === 0) continue;
        let titled = matches.find((p) => p.title && p.title.trim() && p.title !== "N/A"), title = titled?.title?.trim() ?? null, prev = this.seen.get(rule.tool), changedAt = !prev || prev.title !== title ? now : prev.changedAt;
        this.seen.set(rule.tool, { title, changedAt });
        let idle = now - changedAt > this.idleAfterMs;
        out.set(rule.tool, {
          tool: rule.tool,
          cwd: titled?.cwd ?? matches.find((p) => p.cwd)?.cwd ?? null,
          projectHint: title ? projectFromTitle(title, rule.titleSuffixes) : null,
          model: null,
          lastActivityAt: changedAt,
          tokensInputDelta: 0,
          tokensOutputDelta: 0,
          confidence: rule.logBacked || idle || !title ? "presence" : "activity"
        });
      }
      return [...out.values()];
    } catch {
      return [];
    }
  }
};
async function listWindows() {
  let { stdout } = await exec("tasklist", ["/v", "/fo", "csv", "/nh"], { maxBuffer: 8388608, windowsHide: !0 }), out = [];
  for (let line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('"')) continue;
    let cols = line.slice(1, -1).split('","');
    if (cols.length < 9) continue;
    let image = cols[0].toLowerCase().replace(/\.exe$/, ""), title = cols[cols.length - 1];
    out.push({ name: image, pid: Number(cols[1]), title: title === "N/A" ? null : title, cwd: null });
  }
  return out;
}
async function listUnix() {
  let { stdout } = await exec("ps", ["-axo", "pid=,ppid=,comm="], { maxBuffer: 8388608 }), rows = stdout.split(`
`).map((l) => l.trim()).filter(Boolean).map((l) => {
    let m = l.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) return null;
    let comm = m[3], base = comm.split("/").pop() ?? comm;
    return { pid: Number(m[1]), ppid: Number(m[2]), name: base.toLowerCase(), comm };
  }).filter((r) => r !== null), children = /* @__PURE__ */ new Map();
  for (let r of rows) children.set(r.ppid, [...children.get(r.ppid) ?? [], r.pid]);
  let byPid = new Map(rows.map((r) => [r.pid, r])), shells = /* @__PURE__ */ new Set(["zsh", "bash", "fish", "sh"]), out = [];
  for (let r of rows) {
    if (r.name.includes("helper") || !RULES.find((x) => x.names.includes(r.name))) continue;
    let cwd = null, stack = [...children.get(r.pid) ?? []], best = -1;
    for (; stack.length; ) {
      let pid = stack.pop(), p = byPid.get(pid);
      p && (shells.has(p.name) && pid > best && (best = pid), stack.push(...children.get(pid) ?? []));
    }
    best > 0 && (cwd = await cwdOf(best)), out.push({ name: r.name, pid: r.pid, title: null, cwd });
  }
  return out;
}
async function cwdOf(pid) {
  try {
    let { stdout } = await exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]), line = stdout.split(`
`).find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}
function projectFromTitle(title, suffixes) {
  let t = title.replace(/^[●•*]\s*/, "").trim(), lower = t.toLowerCase();
  for (let s of suffixes) {
    if (lower.endsWith(` - ${s}`)) {
      t = t.slice(0, t.length - s.length - 3).trim();
      break;
    }
    if (lower === s) return null;
  }
  if (!t) return null;
  let parts = t.split(" - ").map((p) => p.trim()).filter(Boolean);
  return parts.length === 0 ? null : parts[parts.length - 1].replace(/\s*\[.*?\]\s*$/, "").trim() || null;
}

// src/detector.ts
var Detector = class {
  constructor(activeWindowMs) {
    this.activeWindowMs = activeWindowMs;
    this.adapters = [
      new ClaudeCodeAdapter(activeWindowMs * 6),
      // scan a wider window so idle sessions still resolve
      new CodexAdapter(activeWindowMs * 6),
      new ProcessAdapter(activeWindowMs)
    ];
  }
  activeWindowMs;
  adapters;
  async detect(now = Date.now()) {
    let all = (await Promise.all(this.adapters.map((a) => a.poll().catch(() => [])))).flat();
    if (all.length === 0) return null;
    let tokensIn = 0, tokensOut = 0;
    for (let o of all)
      tokensIn += o.tokensInputDelta, tokensOut += o.tokensOutputDelta;
    let fresh = (o) => now - o.lastActivityAt <= this.activeWindowMs, newest = (list) => list.reduce((best, o) => !best || o.lastActivityAt > best.lastActivityAt ? o : best, null), active = newest(all.filter((o) => o.confidence === "activity" && fresh(o))), pick = active ?? newest(all);
    return pick ? {
      tool: pick.tool,
      model: pick.model,
      cwd: pick.cwd,
      projectHint: pick.projectHint,
      active: active !== null,
      lastActivityAt: pick.lastActivityAt,
      tokensInputDelta: tokensIn,
      tokensOutputDelta: tokensOut
    } : null;
  }
};

// src/projectAlias.ts
var path5 = __toESM(require("node:path")), HIDDEN = "hidden", UNKNOWN_PROJECT_ALIAS = "unknown";
function resolveProjectAlias(cwd, config, hint = null) {
  let folderName = cwd ? path5.basename(cwd) : hint?.trim() || null;
  if (!folderName) return UNKNOWN_PROJECT_ALIAS;
  let override = config.projectAliases?.[folderName];
  return override === HIDDEN ? null : (override ?? folderName).slice(0, 64);
}

// src/queue.ts
var MAX_QUEUE_LENGTH = 500;
function readQueue() {
  return readJson(QUEUE_PATH) ?? [];
}
function writeQueue(queue) {
  writeJsonAtomic(QUEUE_PATH, queue);
}
function enqueue(event) {
  let queue = readQueue();
  for (queue.push(event); queue.length > MAX_QUEUE_LENGTH; ) queue.shift();
  writeQueue(queue);
}
async function flushQueue(send) {
  let queue = readQueue(), delivered = 0;
  for (; queue.length > 0 && await send(queue[0]); )
    queue.shift(), delivered++;
  return writeQueue(queue), { delivered, remaining: queue.length };
}

// src/statusFile.ts
var OFFLINE_STATUS = {
  status: "offline",
  projectAlias: null,
  tool: null,
  model: null,
  sessionStartedAt: null,
  updatedAt: (/* @__PURE__ */ new Date(0)).toISOString()
};
function readStatus() {
  return readJson(STATUS_PATH) ?? { ...OFFLINE_STATUS, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
function writeStatus(status) {
  writeJsonAtomic(STATUS_PATH, status);
}
function writeOfflineStatus() {
  writeStatus({ ...OFFLINE_STATUS, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
}

// src/heartbeat.ts
var UNKNOWN_MODEL = "unknown";
function createLoopState(config) {
  return {
    activeSession: null,
    lastActivityAt: null,
    detector: new Detector(config ? idleThresholdMs(config) : 300 * 1e3),
    pendingTokensIn: 0,
    pendingTokensOut: 0
  };
}
async function postHeartbeat(apiUrl, deviceToken, payload) {
  try {
    return (await fetch(
      `${apiUrl.replace(/\/+$/, "")}/api/v1/tracker/heartbeat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deviceToken}`
        },
        body: JSON.stringify(payload)
      }
    )).ok;
  } catch {
    return !1;
  }
}
async function sendOrQueue(config, payload) {
  await postHeartbeat(config.apiUrl, config.deviceToken, payload) || enqueue({ payload, apiUrl: config.apiUrl, deviceToken: config.deviceToken });
}
async function flushOfflineQueue() {
  return flushQueue(
    (event) => postHeartbeat(event.apiUrl, event.deviceToken, event.payload)
  );
}
function endActiveSession(config, session, occurredAt) {
  return sendOrQueue(config, {
    eventType: "session_end",
    projectAlias: session.projectAlias,
    tool: session.tool,
    model: session.model,
    occurredAt
  });
}
async function tick(config, state) {
  await flushOfflineQueue();
  let now = Date.now(), nowIso = new Date(now).toISOString(), detection = await state.detector.detect(now);
  detection && (state.pendingTokensIn += detection.tokensInputDelta, state.pendingTokensOut += detection.tokensOutputDelta);
  let alias = detection ? resolveProjectAlias(detection.cwd, config, detection.projectHint) : null;
  if (detection && detection.active && alias !== null) {
    let tool = detection.tool, model = detection.model ?? state.activeSession?.model ?? UNKNOWN_MODEL;
    !state.activeSession || state.activeSession.projectAlias !== alias || state.activeSession.tool !== tool || // model unknown → known is a refinement, not a new session
    state.activeSession.model !== model && state.activeSession.model !== UNKNOWN_MODEL ? (state.activeSession && await endActiveSession(config, state.activeSession, nowIso), state.activeSession = { projectAlias: alias, tool, model, startedAt: nowIso }, await sendOrQueue(config, {
      eventType: "session_start",
      projectAlias: alias,
      tool,
      model,
      occurredAt: nowIso
    })) : state.activeSession && (state.activeSession.model = model);
    let session = state.activeSession;
    await sendOrQueue(config, {
      eventType: "heartbeat",
      projectAlias: alias,
      tool,
      model,
      tokensInputDelta: state.pendingTokensIn,
      tokensOutputDelta: state.pendingTokensOut,
      occurredAt: nowIso
    }), state.pendingTokensIn = 0, state.pendingTokensOut = 0, state.lastActivityAt = now, writeStatus({
      status: "active",
      projectAlias: alias,
      tool,
      model,
      sessionStartedAt: session.startedAt,
      updatedAt: nowIso
    });
    return;
  }
  if (!state.activeSession) return;
  let idleAfter = idleThresholdMs(config);
  if (state.lastActivityAt !== null && now - state.lastActivityAt >= idleAfter) {
    let ended = state.activeSession;
    await endActiveSession(config, ended, nowIso), state.activeSession = null, writeStatus({
      status: "idle",
      projectAlias: ended.projectAlias,
      tool: ended.tool,
      model: ended.model,
      sessionStartedAt: ended.startedAt,
      updatedAt: nowIso
    });
  }
}
function runLoop(config) {
  let state = createLoopState(config), safeTick = () => tick(config, state).catch((err) => {
    console.error("tracker: heartbeat tick failed:", err);
  });
  safeTick();
  let interval = setInterval(safeTick, heartbeatIntervalMs(config));
  return { stop: async () => {
    clearInterval(interval), state.activeSession && (await endActiveSession(config, state.activeSession, (/* @__PURE__ */ new Date()).toISOString()), state.activeSession = null), writeOfflineStatus();
  } };
}

// src/daemon.ts
function readPid() {
  return readJson(PID_PATH)?.pid ?? null;
}
function isProcessAlive(pid) {
  try {
    return process.kill(pid, 0), !0;
  } catch {
    return !1;
  }
}
function daemonStatus() {
  let pid = readPid();
  return pid === null ? { running: !1, pid: null } : { running: isProcessAlive(pid), pid };
}
function startDaemon(entryPath) {
  let existing = daemonStatus();
  if (existing.running) {
    console.log(`Tracker is already running (pid ${existing.pid}).`);
    return;
  }
  ensureConfigDir();
  let logFd = fs3.openSync(LOG_PATH, "a"), child = (0, import_node_child_process2.spawn)(process.execPath, [entryPath, "run-loop"], {
    detached: !0,
    stdio: ["ignore", logFd, logFd]
  });
  if (child.unref(), !child.pid) {
    console.error("Failed to start tracker daemon.");
    return;
  }
  writeJsonAtomic(PID_PATH, { pid: child.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }), console.log(`Tracker started (pid ${child.pid}). Logs: ${LOG_PATH}`);
}
function stopDaemon() {
  let { running, pid } = daemonStatus();
  if (!running || pid === null) {
    console.log("Tracker is not running."), removeFile(PID_PATH), writeOfflineStatus();
    return;
  }
  try {
    process.kill(pid, "SIGTERM"), console.log(`Stop signal sent (pid ${pid}).`);
  } catch (err) {
    console.error("Failed to stop tracker:", err);
  }
  removeFile(PID_PATH);
}
function runForeground(config) {
  let { stop } = runLoop(config), shuttingDown = !1, shutdown = () => {
    shuttingDown || (shuttingDown = !0, stop().catch((err) => console.error("tracker: error during shutdown:", err)).finally(() => {
      removeFile(PID_PATH), process.exit(0);
    }));
  };
  process.on("SIGTERM", shutdown), process.on("SIGINT", shutdown);
}

// src/index.ts
var CONFIG_PATH_LABEL = "~/.vibehub/config.json", STATUS_PATH_LABEL = "~/.vibehub/status.json", program2 = new Command();
program2.name("vibehub-tracker").description("VibeHub local activity tracker");
program2.command("login <deviceToken>").description(`write ${CONFIG_PATH_LABEL} with the given device token`).option("--api-url <url>", "VibeHub server URL", DEFAULT_API_URL).action((deviceToken, options) => {
  let existing = readConfig(), config = {
    apiUrl: options.apiUrl,
    deviceToken,
    projectAliases: existing?.projectAliases ?? {},
    heartbeatIntervalMs: existing?.heartbeatIntervalMs,
    idleThresholdMs: existing?.idleThresholdMs,
    toolProcessNames: existing?.toolProcessNames
  };
  writeConfig(config), console.log(`Logged in. Wrote ${CONFIG_PATH_LABEL} (apiUrl: ${config.apiUrl}).`);
});
program2.command("set <projectFolder> <alias>").description(`remap a project folder's display alias, or hide it with the literal "${HIDDEN}"`).action((projectFolder, alias) => {
  let config = requireConfig();
  config.projectAliases = { ...config.projectAliases, [projectFolder]: alias }, writeConfig(config), console.log(
    alias === HIDDEN ? `"${projectFolder}" will be hidden from presence.` : `"${projectFolder}" will be shown as "${alias}".`
  );
});
program2.command("start").description("poll for active coding-tool processes and send heartbeats").action(() => {
  requireConfig(), startDaemon(path6.resolve(__filename));
});
program2.command("status").description(`pretty-print the current ${STATUS_PATH_LABEL}`).action(() => {
  if (!readConfig()) {
    console.log("Not logged in. Run `vibehub-tracker login <deviceToken>` first.");
    return;
  }
  let status = readStatus(), { running, pid } = daemonStatus();
  console.log(`Daemon:  ${running ? `running (pid ${pid})` : "not running"}`), console.log(`Status:  ${status.status}`), status.status !== "offline" && (console.log(`Project: ${status.projectAlias}`), console.log(`Tool:    ${status.tool}`), console.log(`Model:   ${status.model}`), console.log(`Started: ${status.sessionStartedAt}`)), console.log(`Updated: ${status.updatedAt}`);
});
program2.command("stop").description("stop the running tracker daemon").action(() => {
  stopDaemon();
});
program2.command("logout").description(`stop the daemon and remove ${CONFIG_PATH_LABEL}`).action(() => {
  stopDaemon(), deleteConfig(), writeOfflineStatus(), console.log(`Logged out. Removed ${CONFIG_PATH_LABEL}.`);
});
program2.command("run-loop", { hidden: !0 }).description("internal: runs the heartbeat loop in the foreground (spawned by `start`)").action(() => {
  let config = requireConfig();
  runForeground(config);
});
program2.parse();
