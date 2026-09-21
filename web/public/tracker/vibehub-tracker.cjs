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
    var EventEmitter = require("node:events").EventEmitter, childProcess = require("node:child_process"), path6 = require("node:path"), fs9 = require("node:fs"), process2 = require("node:process"), { Argument: Argument2, humanReadableArgName } = require_argument(), { CommanderError: CommanderError2 } = require_error(), { Help: Help2 } = require_help(), { Option: Option2, DualOptions } = require_option(), { suggestSimilar } = require_suggestSimilar(), Command2 = class _Command extends EventEmitter {
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
          let localBin = path6.resolve(baseDir, baseName);
          if (fs9.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path6.extname(baseName))) return;
          let foundExt = sourceExt.find(
            (ext) => fs9.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
        }
        this._checkForMissingMandatoryOptions(), this._checkForConflictingOptions();
        let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`, executableDir = this._executableDir || "";
        if (this._scriptPath) {
          let resolvedScriptPath;
          try {
            resolvedScriptPath = fs9.realpathSync(this._scriptPath);
          } catch {
            resolvedScriptPath = this._scriptPath;
          }
          executableDir = path6.resolve(
            path6.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            let legacyName = path6.basename(
              this._scriptPath,
              path6.extname(this._scriptPath)
            );
            legacyName !== this._name && (localFile = findFile(
              executableDir,
              `${legacyName}-${subcommand._name}`
            ));
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path6.extname(executableFile));
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
        let result = promise, hooks2 = [];
        return this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
          hookedCommand._lifeCycleHooks[event].forEach((callback) => {
            hooks2.push({ hookedCommand, callback });
          });
        }), event === "postAction" && hooks2.reverse(), hooks2.forEach((hookDetail) => {
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
        return this._name = path6.basename(filename, path6.extname(filename)), this;
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
      executableDir(path7) {
        return path7 === void 0 ? this._executableDir : (this._executableDir = path7, this);
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
var path5 = __toESM(require("node:path"));

// src/config.ts
var import_node_crypto2 = require("node:crypto");

// src/paths.ts
var os = __toESM(require("node:os")), path = __toESM(require("node:path")), fs = __toESM(require("node:fs")), import_node_crypto = require("node:crypto"), CONFIG_DIR = path.join(os.homedir(), ".vibehub"), CONFIG_PATH = path.join(CONFIG_DIR, "config.json"), STATUS_PATH = path.join(CONFIG_DIR, "status.json"), QUEUE_PATH = path.join(CONFIG_DIR, "queue.json"), PID_PATH = path.join(CONFIG_DIR, "tracker.pid"), LOG_PATH = path.join(CONFIG_DIR, "daemon.log"), STOP_REQUEST_PATH = path.join(CONFIG_DIR, "stop.request"), ATTESTED_PATH = path.join(CONFIG_DIR, "attested.jsonl"), JSON_PATHS = /* @__PURE__ */ new Set([CONFIG_PATH, STATUS_PATH, PID_PATH, STOP_REQUEST_PATH]), MAX_STATE_BYTES = 64 * 1024, normalized = (p) => process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p);
function configDirSafe() {
  return safeDirectory();
}
function safeDirectory() {
  try {
    let s = fs.lstatSync(CONFIG_DIR);
    return s.isDirectory() && !s.isSymbolicLink() && normalized(fs.realpathSync(CONFIG_DIR)) === normalized(CONFIG_DIR);
  } catch {
    return !1;
  }
}
function ensureConfigDir() {
  if (fs.mkdirSync(CONFIG_DIR, { recursive: !0, mode: 448 }), !safeDirectory()) throw new Error("Tracker state directory is unavailable.");
  try {
    fs.chmodSync(CONFIG_DIR, 448);
  } catch {
  }
}
function writeJsonAtomic(filePath, data) {
  if (!JSON_PATHS.has(filePath)) throw new Error("Unsupported tracker state file.");
  let raw = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(raw) > MAX_STATE_BYTES) throw new Error("Tracker state exceeds its bound.");
  ensureConfigDir();
  try {
    let s = fs.lstatSync(filePath);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new Error("Tracker state file is unavailable.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let temporary = path.join(CONFIG_DIR, `.${path.basename(filePath)}.${(0, import_node_crypto.randomUUID)()}.tmp`);
  try {
    fs.writeFileSync(temporary, raw, { mode: 384, flag: "wx" }), fs.renameSync(temporary, filePath);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
    }
  }
}
function removeFile(filePath) {
  if (!(!JSON_PATHS.has(filePath) || !safeDirectory()))
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
}
function readJson(filePath) {
  let fd;
  try {
    if (!JSON_PATHS.has(filePath) || !safeDirectory()) return null;
    let before = fs.lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_STATE_BYTES) return null;
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_STATE_BYTES || !safeDirectory()) return null;
    let buffer = Buffer.alloc(opened.size + 1), bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return bytes !== opened.size ? null : JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
  } catch {
    return null;
  } finally {
    if (fd !== void 0)
      try {
        fs.closeSync(fd);
      } catch {
      }
  }
}

// src/privacy.ts
var COLLECTION_POLICY = "ai-session-metadata-v1";
var NATIVE_TOOLS = ["claude-code", "codex", "quadcode"], ATTESTED_TOOLS = ["quadcode", "cursor", "windsurf"], TOKENLESS_TOOLS = ["quadcode", "cursor", "windsurf"], SUPPORTED_TOOLS = [...NATIVE_TOOLS, "cursor", "windsurf"], MAX_RECORD_AGE_MS = 1440 * 6e4, MAX_EVENT_AGE_MS = 5 * 6e4, MAX_FUTURE_SKEW_MS = 5e3, MAX_TOKEN_COUNT = 1e9, MAX_USAGE_ENTRIES = 30, CLAUDE_MODELS = /* @__PURE__ */ new Set([
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5-20251101",
  "claude-opus-4-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5"
]), CODEX_MODELS = /* @__PURE__ */ new Set([
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4-pro",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-2025-08-07",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-pro",
  "gpt-4.1",
  "gpt-4.1-2025-04-14",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-05-13",
  "gpt-4o-mini",
  "o1",
  "o1-pro",
  "o3-pro",
  "o3",
  "o4-mini",
  "o3-mini",
  "gpt-5-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max",
  "gpt-5.2-codex",
  "gpt-5.3-codex"
]);
function objectRecord(value) {
  return value !== null && typeof value == "object" && !Array.isArray(value) ? value : null;
}
var supported = new Set(SUPPORTED_TOOLS), native = new Set(NATIVE_TOOLS), attested = new Set(ATTESTED_TOOLS), tokenless = new Set(TOKENLESS_TOOLS);
function isSupportedTool(tool) {
  return typeof tool == "string" && supported.has(tool);
}
function isAttestedTool(tool) {
  return typeof tool == "string" && attested.has(tool);
}
function isTokenlessTool(tool) {
  return typeof tool == "string" && tokenless.has(tool);
}
function safeModel(value, tool) {
  return typeof value != "string" ? null : (tool === "claude-code" ? CLAUDE_MODELS.has(value) : tool === "codex" ? CODEX_MODELS.has(value) : CLAUDE_MODELS.has(value) || CODEX_MODELS.has(value)) ? value : null;
}
function isCount(value, maximum = MAX_TOKEN_COUNT) {
  return typeof value == "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function eventTime(value, now, maxAgeMs = MAX_EVENT_AGE_MS) {
  if (typeof value != "string" || value.length > 35 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  let at = Date.parse(value);
  return Number.isFinite(at) && at <= now + MAX_FUTURE_SKEW_MS && at >= now - Math.min(maxAgeMs, MAX_EVENT_AGE_MS) ? Math.min(at, now) : null;
}
function safeAlias(value) {
  return typeof value == "string" && value.length <= 64 && /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9_. -]/.test(value) && value.trim() === value && !value.includes("..") && !["__proto__", "prototype", "constructor"].includes(value) ? value : null;
}
function folderFromCwd(value) {
  if (typeof value != "string" || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value) || !/^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(value)) return null;
  let parts = value.replace(/\\/g, "/").split("/");
  return parts.some((part) => part === "." || part === "..") ? null : safeAlias(parts.filter(Boolean).at(-1));
}
function safeApiOrigin(value) {
  if (typeof value != "string" || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) return null;
  try {
    let url = new URL(value);
    return url.username || url.password || url.search || url.hash || url.pathname !== "/" && url.pathname !== "" || url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ? null : url.origin;
  } catch {
    return null;
  }
}
function safeDeviceToken(value) {
  return typeof value == "string" && value.length >= 1 && value.length <= 512 && !/[^A-Za-z0-9._~-]/.test(value);
}
function projectUsage(value) {
  let u = objectRecord(value);
  return !u || !isSupportedTool(u.tool) || u.estimated === !0 || isTokenlessTool(u.tool) || !isCount(u.tokensInputDelta) || !isCount(u.tokensOutputDelta) ? null : {
    tool: u.tool,
    model: safeModel(u.model, u.tool),
    tokensInputDelta: u.tokensInputDelta,
    tokensOutputDelta: u.tokensOutputDelta
  };
}
function projectHeartbeat(value, now = Date.now()) {
  let p = objectRecord(value);
  if (!p || !isSupportedTool(p.tool) || !["heartbeat", "session_start", "session_end"].includes(String(p.eventType))) return null;
  let alias = safeAlias(p.projectAlias), at = eventTime(p.occurredAt, now);
  if (!alias || at === null) return null;
  let result = {
    eventType: p.eventType,
    projectAlias: alias,
    tool: p.tool,
    model: safeModel(p.model, p.tool),
    occurredAt: new Date(at).toISOString()
  };
  if (result.eventType !== "heartbeat") return result;
  if (!Array.isArray(p.usage) || p.usage.length > MAX_USAGE_ENTRIES) return null;
  let usage = [];
  for (let entry of p.usage) {
    let u = projectUsage(entry);
    if (!u) return null;
    (u.tokensInputDelta || u.tokensOutputDelta) && usage.push(u);
  }
  let input = usage.reduce((sum, u) => sum + u.tokensInputDelta, 0), output = usage.reduce((sum, u) => sum + u.tokensOutputDelta, 0);
  if (!isCount(input) || !isCount(output)) return null;
  if (result.usage = usage, (!isTokenlessTool(result.tool) || usage.length) && (result.tokensInputDelta = input, result.tokensOutputDelta = output), p.tools !== void 0) {
    if (!Array.isArray(p.tools) || p.tools.length > SUPPORTED_TOOLS.length) return null;
    result.tools = [];
    for (let entry of p.tools) {
      let tool = objectRecord(entry);
      if (!tool || !isSupportedTool(tool.tool)) return null;
      result.tools.push({ tool: tool.tool, model: safeModel(tool.model, tool.tool), projectAlias: safeAlias(tool.projectAlias) });
    }
  }
  return result;
}

// src/config.ts
function projectAttestedMetadata(value) {
  if (value === void 0) return null;
  let a = objectRecord(value);
  if (!a || typeof a.enabled != "boolean" || !Array.isArray(a.tools) || a.tools.length > ATTESTED_TOOLS.length) return "invalid";
  let tools = [];
  for (let tool of a.tools) {
    if (!isAttestedTool(tool) || tools.includes(tool)) return "invalid";
    tools.push(tool);
  }
  return { enabled: a.enabled, tools };
}
function attestedToolsFor(config) {
  let a = config.attestedMetadata;
  return a?.enabled ? [...a.tools] : [];
}
var DEFAULT_API_URL = process.env.VIBEHUB_API_URL ?? "https://server-production-cc06.up.railway.app", DEFAULT_HEARTBEAT_INTERVAL_MS = 3e4, DEFAULT_IDLE_THRESHOLD_MS = MAX_EVENT_AGE_MS;
function projectConfig(value) {
  let c = objectRecord(value), apiUrl = safeApiOrigin(c?.apiUrl);
  if (!c || !apiUrl || !safeDeviceToken(c.deviceToken)) return null;
  let aliases = c.projectAliases === void 0 ? {} : objectRecord(c.projectAliases);
  if (!aliases || Object.keys(aliases).length > 100) return null;
  let projectAliases = {};
  for (let [folder, alias] of Object.entries(aliases)) {
    if (!safeAlias(folder) || !safeAlias(alias)) return null;
    projectAliases[folder] = alias;
  }
  for (let key of ["heartbeatIntervalMs", "idleThresholdMs"]) {
    let n = c[key];
    if (n !== void 0 && (typeof n != "number" || !Number.isSafeInteger(n) || n < 1 || n > 864e5)) return null;
  }
  let attested2 = projectAttestedMetadata(c.attestedMetadata);
  return attested2 === "invalid" ? null : {
    apiUrl,
    deviceToken: c.deviceToken,
    projectAliases,
    ...c.heartbeatIntervalMs !== void 0 ? { heartbeatIntervalMs: c.heartbeatIntervalMs } : {},
    ...c.idleThresholdMs !== void 0 ? { idleThresholdMs: c.idleThresholdMs } : {},
    ...attested2 ? { attestedMetadata: attested2 } : {}
  };
}
function configFingerprint(config) {
  return (0, import_node_crypto2.createHash)("sha256").update(JSON.stringify({
    apiUrl: config.apiUrl,
    deviceToken: config.deviceToken,
    aliases: Object.entries(config.projectAliases).sort(([a], [b]) => a.localeCompare(b)),
    // Flipping the receiver switch (or its tool list) re-fences collected state, so
    // records accepted under one consent setting cannot survive into another.
    attested: attestedToolsFor(config).slice().sort(),
    idle: idleThresholdMs(config)
  })).digest("hex");
}
function readConfig() {
  return projectConfig(readJson(CONFIG_PATH));
}
function requireConfig() {
  let config = readConfig();
  return config || (console.error("Not logged in or config invalid. Run `vibehub-tracker login <deviceToken>` first."), process.exit(1)), config;
}
function writeConfig(config) {
  let safe = projectConfig(config);
  if (!safe) throw new Error("Invalid tracker config.");
  writeJsonAtomic(CONFIG_PATH, safe);
}
function deleteConfig() {
  removeFile(CONFIG_PATH);
}
function heartbeatIntervalMs(config) {
  return config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
}
function idleThresholdMs(config) {
  return Math.min(config.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS, MAX_EVENT_AGE_MS);
}

// src/daemon.ts
var import_node_child_process = require("node:child_process"), import_node_console = require("node:console"), fs6 = __toESM(require("node:fs"));

// src/adapters/attested.ts
var import_node_fs = __toESM(require("node:fs")), import_node_crypto3 = require("node:crypto"), import_node_util = require("node:util");
var ATTESTED_RECORD_VERSION = 1, MAX_ATTESTED_FILE_BYTES = 32 * 1024 * 1024, MAX_ATTESTED_CHUNK_BYTES = 1024 * 1024, MAX_ATTESTED_LINE_BYTES = 64 * 1024, MAX_ATTESTED_RECORDS_PER_POLL = 128, MAX_SEEN_DIGESTS = 4096, utf8 = new import_node_util.TextDecoder("utf-8", { fatal: !0 }), regularFile = (s) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.ino > 0n && s.size >= 0n && s.size <= BigInt(MAX_ATTESTED_FILE_BYTES), samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b, AttestedTailer = class {
  cursor = null;
  clear() {
    this.cursor = null;
  }
  checked() {
    if (!configDirSafe()) return null;
    try {
      let s = import_node_fs.default.lstatSync(ATTESTED_PATH, { bigint: !0 });
      return regularFile(s) && samePath(import_node_fs.default.realpathSync(ATTESTED_PATH), ATTESTED_PATH) ? s : null;
    } catch {
      return null;
    }
  }
  prime(fd, s) {
    let size = Number(s.size), skipPartial = !1;
    if (size > 0) {
      let last = Buffer.alloc(1);
      skipPartial = import_node_fs.default.readSync(fd, last, 0, 1, size - 1) !== 1 || last[0] !== 10;
    }
    return { dev: s.dev, ino: s.ino, offset: size, size, mtime: s.mtimeNs, skipPartial };
  }
  /** Emits only lines appended since the previous poll. First sight primes at EOF. */
  readNewLines(visit, signal) {
    if (signal?.aborted) return;
    let fd;
    try {
      let before = this.checked();
      if (!before) {
        this.cursor = null;
        return;
      }
      fd = import_node_fs.default.openSync(ATTESTED_PATH, import_node_fs.default.constants.O_RDONLY | (import_node_fs.default.constants.O_NOFOLLOW ?? 0) | (import_node_fs.default.constants.O_NONBLOCK ?? 0));
      let s = import_node_fs.default.fstatSync(fd, { bigint: !0 }), after = this.checked();
      if (!regularFile(s) || !after || s.dev !== before.dev || s.ino !== before.ino || s.dev !== after.dev || s.ino !== after.ino || signal?.aborted) {
        this.cursor = null;
        return;
      }
      let size = Number(s.size), cursor = this.cursor;
      if (!cursor || cursor.dev !== s.dev || cursor.ino !== s.ino || size < cursor.size || size === cursor.size && s.mtimeNs !== cursor.mtime || size - cursor.offset > MAX_ATTESTED_CHUNK_BYTES) {
        this.cursor = this.prime(fd, s);
        return;
      }
      if (size <= cursor.offset) return;
      let start = cursor.offset, buffer = Buffer.alloc(size - start), bytes = import_node_fs.default.readSync(fd, buffer, 0, buffer.length, start), current = this.checked();
      if (signal?.aborted || !current || current.dev !== s.dev || current.ino !== s.ino) {
        this.cursor = null;
        return;
      }
      cursor.size = size, cursor.mtime = s.mtimeNs;
      let lineStart = 0, records = 0;
      for (; lineStart < bytes && !signal?.aborted; ) {
        let end = buffer.indexOf(10, lineStart);
        if (end < 0 || end >= bytes) break;
        if (!cursor.skipPartial && end - lineStart <= MAX_ATTESTED_LINE_BYTES && records++ < MAX_ATTESTED_RECORDS_PER_POLL)
          try {
            visit(JSON.parse(utf8.decode(buffer.subarray(lineStart, end))));
          } catch {
          }
        cursor.skipPartial = !1, lineStart = end + 1;
      }
      cursor.offset = start + lineStart, (cursor.skipPartial || bytes - lineStart > MAX_ATTESTED_LINE_BYTES) && (cursor.offset = start + bytes, cursor.skipPartial = !0);
    } catch {
      this.cursor = null;
    } finally {
      if (fd !== void 0)
        try {
          import_node_fs.default.closeSync(fd);
        } catch {
        }
    }
  }
};
function projectAttestedRecord(value, now, windowMs, tools) {
  let r = objectRecord(value);
  if (!r || r.v !== ATTESTED_RECORD_VERSION) return null;
  let tool = r.tool;
  if (!isAttestedTool(tool) || !tools.includes(tool) || Object.hasOwn(r, "estimated") || typeof r.recordId != "string" || r.recordId.length < 1 || r.recordId.length > 128 || /[^A-Za-z0-9._-]/.test(r.recordId)) return null;
  let at = eventTime(r.occurredAt, now, windowMs);
  if (at === null) return null;
  let model = safeModel(r.model, tool), projectHint = r.projectHint === null || r.projectHint === void 0 ? null : safeAlias(r.projectHint);
  if (projectHint === null && typeof r.projectHint == "string") return null;
  let hasInput = Object.hasOwn(r, "tokensInputDelta"), hasOutput = Object.hasOwn(r, "tokensOutputDelta"), tokensInputDelta = 0, tokensOutputDelta = 0, usage = [];
  if (r.measured === !0) {
    if (!isCount(r.tokensInputDelta) || !isCount(r.tokensOutputDelta)) return null;
    isTokenlessTool(tool) || (tokensInputDelta = r.tokensInputDelta, tokensOutputDelta = r.tokensOutputDelta, (tokensInputDelta || tokensOutputDelta) && usage.push({ model, tokensInputDelta, tokensOutputDelta }));
  } else if (r.measured === !1 || r.measured === void 0) {
    if (hasInput || hasOutput) return null;
  } else return null;
  return {
    tool,
    cwd: null,
    projectHint,
    model,
    confidence: "activity",
    lastActivityAt: at,
    observedAt: at,
    tokensInputDelta,
    tokensOutputDelta,
    usage
  };
}
var AttestedMetadataAdapter = class {
  constructor(activeWindowMs, tools = []) {
    this.activeWindowMs = activeWindowMs;
    this.tools = [...tools].filter(isAttestedTool);
  }
  activeWindowMs;
  name = "attested";
  tailer = new AttestedTailer();
  seen = /* @__PURE__ */ new Set();
  tools;
  /** Consent change, account change, pause and cancellation all land here. */
  clear() {
    this.tailer.clear(), this.seen.clear();
  }
  async poll(now = Date.now(), signal) {
    if (!this.tools.length || signal?.aborted) return [];
    let observations = [];
    return this.tailer.readNewLines((record) => {
      let observation = projectAttestedRecord(record, now, this.activeWindowMs, this.tools);
      if (!observation) return;
      let digest = (0, import_node_crypto3.createHash)("sha256").update(`${observation.tool}\0${record.recordId}`).digest("hex");
      this.seen.has(digest) || (this.seen.size >= MAX_SEEN_DIGESTS && this.seen.delete(this.seen.values().next().value), this.seen.add(digest), observations.push(observation));
    }, signal), signal?.aborted ? [] : observations;
  }
};

// src/adapters/claudeCode.ts
var import_node_crypto4 = require("node:crypto");

// src/adapters/jsonlTail.ts
var import_node_fs2 = __toESM(require("node:fs")), import_node_os = __toESM(require("node:os")), import_node_path = __toESM(require("node:path")), import_node_util2 = require("node:util"), MAX_LOG_FILES = 128, MAX_DIRECTORY_ENTRIES = 2048, MAX_CHUNK_BYTES = 1024 * 1024, MAX_LINE_BYTES = 256 * 1024, MAX_RECORDS_PER_FILE = 256, MAX_FILE_BYTES = 256 * 1024 * 1024, utf82 = new import_node_util2.TextDecoder("utf-8", { fatal: !0 }), samePath2 = (a, b) => process.platform === "win32" ? import_node_path.default.resolve(a).toLowerCase() === import_node_path.default.resolve(b).toLowerCase() : import_node_path.default.resolve(a) === import_node_path.default.resolve(b), sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino, regularFile2 = (s) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.ino > 0n && s.size >= 0n && s.size <= BigInt(MAX_FILE_BYTES), JsonlTailer = class {
  constructor(source) {
    this.source = source;
    this.configRoot = import_node_path.default.join(this.home, source === "claude-code" ? ".claude" : ".codex"), this.root = import_node_path.default.join(this.configRoot, source === "claude-code" ? "projects" : "sessions"), this.overrideName = source === "claude-code" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  }
  source;
  home = import_node_path.default.resolve(import_node_os.default.homedir());
  configRoot;
  root;
  overrideName;
  states = /* @__PURE__ */ new Map();
  listed = /* @__PURE__ */ new Set();
  nextGeneration = 1;
  clear() {
    this.states.clear(), this.listed.clear();
  }
  generation(file) {
    return this.states.get(file)?.generation ?? 0;
  }
  rootsAllowed() {
    let override = process.env[this.overrideName];
    return override && (!import_node_path.default.isAbsolute(override) || !samePath2(override, this.configRoot)) || !import_node_path.default.isAbsolute(this.home) || /^(?:\\\\|\/\/)/.test(this.home) ? !1 : [this.home, this.configRoot, this.root].every((dir) => this.unlinkedDirectory(dir));
  }
  unlinkedDirectory(dir) {
    try {
      let s = import_node_fs2.default.lstatSync(dir);
      return s.isDirectory() && !s.isSymbolicLink() && samePath2(import_node_fs2.default.realpathSync(dir), dir);
    } catch {
      return !1;
    }
  }
  layout(parts, isDirectory) {
    if (parts.some((p) => !p || p.length > 200 || /[\x00-\x20\x7f\\/:]/.test(p) || p === "." || p === "..")) return !1;
    if (this.source === "claude-code")
      return isDirectory ? parts.length <= 1 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)) : parts.length === 2 && /^[A-Za-z0-9_-]+$/.test(parts[0]) && /^[A-Za-z0-9_-]+\.jsonl$/.test(parts[1]);
    let directories = [/^\d{4}$/, /^(?:0[1-9]|1[0-2])$/, /^(?:0[1-9]|[12]\d|3[01])$/], count = isDirectory ? parts.length : parts.length - 1;
    return count > 3 || !isDirectory && count !== 3 || !parts.slice(0, count).every((p, i) => directories[i].test(p)) ? !1 : isDirectory || /^rollout-[A-Za-z0-9_-]+\.jsonl$/.test(parts[3]);
  }
  checkedPath(file, isDirectory) {
    if (!this.rootsAllowed()) return null;
    let relative = import_node_path.default.relative(this.root, file);
    if (relative.startsWith("..") || import_node_path.default.isAbsolute(relative)) return null;
    let parts = relative ? relative.split(import_node_path.default.sep) : [];
    if (!this.layout(parts, isDirectory)) return null;
    let current = this.root;
    for (let part of isDirectory ? parts : parts.slice(0, -1))
      if (current = import_node_path.default.join(current, part), !this.unlinkedDirectory(current)) return null;
    try {
      let s = import_node_fs2.default.lstatSync(file, { bigint: !0 });
      return (isDirectory ? !s.isDirectory() || s.isSymbolicLink() : !regularFile2(s)) ? null : samePath2(import_node_fs2.default.realpathSync(file), file) ? s : null;
    } catch {
      return null;
    }
  }
  /** Bounded directory metadata enumeration ONLY within the exact layouts above. */
  files(signal) {
    this.listed.clear();
    let remaining = MAX_DIRECTORY_ENTRIES, candidates = [], walk = (dir, depth) => {
      if (signal?.aborted || remaining <= 0 || !this.checkedPath(dir, !0)) return;
      let handle;
      try {
        if (handle = import_node_fs2.default.opendirSync(dir, { bufferSize: 16 }), !this.checkedPath(dir, !0)) return;
        let entries = [], entry;
        for (; remaining-- > 0 && !signal?.aborted && (entry = handle.readSync()); ) entries.push(entry);
        entries.sort((a, b) => b.name.localeCompare(a.name));
        for (let e of entries) {
          if (signal?.aborted) break;
          let file = import_node_path.default.join(dir, e.name);
          if (!e.isSymbolicLink()) {
            if (e.isDirectory() && depth < (this.source === "claude-code" ? 1 : 3))
              walk(file, depth + 1);
            else if (e.isFile()) {
              let s = this.checkedPath(file, !1);
              s && candidates.push({ file, mtime: Number(s.mtimeMs) });
            }
          }
        }
      } catch {
      } finally {
        try {
          handle?.closeSync();
        } catch {
        }
      }
    };
    walk(this.root, 0);
    for (let { file } of candidates.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_LOG_FILES)) this.listed.add(file);
    for (let file of this.states.keys()) this.listed.has(file) || this.states.delete(file);
    return [...this.listed];
  }
  prime(fd, s) {
    let size = Number(s.size), skipPartial = !1;
    if (size > 0) {
      let last = Buffer.alloc(1);
      skipPartial = import_node_fs2.default.readSync(fd, last, 0, 1, size - 1) !== 1 || last[0] !== 10;
    }
    return {
      dev: s.dev,
      ino: s.ino,
      offset: size,
      size,
      mtime: s.mtimeNs,
      skipPartial,
      generation: this.nextGeneration++
    };
  }
  readNewLines(file, visit, signal) {
    if (signal?.aborted || !this.listed.has(file)) return;
    let fd;
    try {
      let before = this.checkedPath(file, !1);
      if (!before) {
        this.states.delete(file);
        return;
      }
      fd = import_node_fs2.default.openSync(file, import_node_fs2.default.constants.O_RDONLY | (import_node_fs2.default.constants.O_NOFOLLOW ?? 0) | (import_node_fs2.default.constants.O_NONBLOCK ?? 0));
      let s = import_node_fs2.default.fstatSync(fd, { bigint: !0 }), after = this.checkedPath(file, !1);
      if (!regularFile2(s) || !after || !sameFile(before, s) || !sameFile(s, after) || signal?.aborted) {
        this.states.delete(file);
        return;
      }
      let size = Number(s.size), cursor = this.states.get(file);
      if (!cursor || cursor.dev !== s.dev || cursor.ino !== s.ino || size < cursor.size || size === cursor.size && s.mtimeNs !== cursor.mtime || size - cursor.offset > MAX_CHUNK_BYTES) {
        this.states.set(file, this.prime(fd, s));
        return;
      }
      if (size <= cursor.offset) return;
      let start = cursor.offset, buffer = Buffer.alloc(size - start), bytes = import_node_fs2.default.readSync(fd, buffer, 0, buffer.length, start), current = this.checkedPath(file, !1);
      if (signal?.aborted || !current || !sameFile(s, current)) {
        this.states.delete(file);
        return;
      }
      cursor.size = size, cursor.mtime = s.mtimeNs;
      let lineStart = 0, records = 0;
      for (; lineStart < bytes && !signal?.aborted; ) {
        let end = buffer.indexOf(10, lineStart);
        if (end < 0 || end >= bytes) break;
        if (!cursor.skipPartial && end - lineStart <= MAX_LINE_BYTES && records++ < MAX_RECORDS_PER_FILE)
          try {
            visit(JSON.parse(utf82.decode(buffer.subarray(lineStart, end))), cursor.generation);
          } catch {
          }
        cursor.skipPartial = !1, lineStart = end + 1;
      }
      cursor.offset = start + lineStart, (cursor.skipPartial || bytes - lineStart > MAX_LINE_BYTES) && (cursor.offset = start + bytes, cursor.skipPartial = !0);
    } catch {
      this.states.delete(file);
    } finally {
      if (fd !== void 0)
        try {
          import_node_fs2.default.closeSync(fd);
        } catch {
        }
    }
  }
};

// src/adapters/usage.ts
var UsageAccumulator = class {
  buckets = /* @__PURE__ */ new Map();
  add(model, input, output, estimated = !1) {
    if (estimated || !isCount(input) || !isCount(output) || !isCount(this.totalInput + input) || !isCount(this.totalOutput + output)) return !1;
    let knownModel = safeModel(model), key = knownModel ?? "";
    if (!this.buckets.has(key) && this.buckets.size >= MAX_USAGE_ENTRIES) return !1;
    let previous = this.buckets.get(key);
    return this.buckets.set(key, {
      model: knownModel,
      tokensInputDelta: (previous?.tokensInputDelta ?? 0) + input,
      tokensOutputDelta: (previous?.tokensOutputDelta ?? 0) + output
    }), !0;
  }
  toList() {
    return [...this.buckets.values()].filter((u) => u.tokensInputDelta > 0 || u.tokensOutputDelta > 0).map((u) => ({ model: u.model, tokensInputDelta: u.tokensInputDelta, tokensOutputDelta: u.tokensOutputDelta }));
  }
  get totalInput() {
    return [...this.buckets.values()].reduce((n, u) => n + u.tokensInputDelta, 0);
  }
  get totalOutput() {
    return [...this.buckets.values()].reduce((n, u) => n + u.tokensOutputDelta, 0);
  }
};

// src/adapters/claudeCode.ts
var ClaudeCodeAdapter = class {
  constructor(recentWindowMs) {
    this.recentWindowMs = recentWindowMs;
  }
  recentWindowMs;
  name = "claude-code";
  tailer = new JsonlTailer("claude-code");
  fileMeta = /* @__PURE__ */ new Map();
  receipts = /* @__PURE__ */ new Map();
  clear() {
    this.tailer.clear(), this.fileMeta.clear(), this.receipts.clear();
  }
  async poll(now = Date.now(), signal) {
    let files = this.tailer.files(signal), present = new Set(files);
    for (let file of this.fileMeta.keys()) present.has(file) || this.fileMeta.delete(file);
    for (let [id, receipt] of this.receipts) now - receipt.at > MAX_EVENT_AGE_MS && this.receipts.delete(id);
    let out = [];
    for (let file of files) {
      if (signal?.aborted) break;
      let meta = this.fileMeta.get(file), usage = new UsageAccumulator();
      if (this.tailer.readNewLines(file, (raw, generation) => {
        let line = objectRecord(raw);
        if (!line || line.type !== "assistant") return;
        let message = objectRecord(line.message), counts = objectRecord(message?.usage), at = eventTime(line.timestamp, now, this.recentWindowMs);
        if (!message || message.role !== "assistant" || !counts || at === null || typeof message.id != "string" || message.id.length > 128 || !/^msg_[A-Za-z0-9_-]+$/.test(message.id) || /\s/.test(message.id) || message.model === "<synthetic>" || !isCount(counts.input_tokens) || !isCount(counts.output_tokens) || !isCount(counts.cache_read_input_tokens ?? 0) || !isCount(counts.cache_creation_input_tokens ?? 0)) return;
        let input = counts.input_tokens + (counts.cache_read_input_tokens ?? 0) + (counts.cache_creation_input_tokens ?? 0), output = counts.output_tokens;
        if (!isCount(input)) return;
        let projectHint = folderFromCwd(line.cwd);
        if (!projectHint || (meta?.generation === generation && meta.projectHint !== projectHint && (meta.invalidProject = !0), meta?.generation === generation && meta.invalidProject)) return;
        let model = safeModel(message.model, "claude-code"), id = (0, import_node_crypto4.createHash)("sha256").update(message.id).digest("hex"), previous = this.receipts.get(id);
        if (previous && (previous.model !== model || at < previous.at || input < previous.input || output < previous.output)) return;
        let inputDelta = input - (previous?.input ?? 0), outputDelta = output - (previous?.output ?? 0);
        if (!(!(inputDelta || outputDelta) || !usage.add(model, inputDelta, outputDelta))) {
          for (this.receipts.set(id, { input, output, model, at }); this.receipts.size > 2048; ) this.receipts.delete(this.receipts.keys().next().value);
          (!meta || meta.generation !== generation) && (meta = { generation, projectHint, model: null, lastActivityAt: 0, invalidProject: !1 }), meta.projectHint = folderFromCwd(line.cwd), meta.model = model, meta.lastActivityAt = Math.max(meta.lastActivityAt, at);
        }
      }, signal), !meta || meta.generation !== this.tailer.generation(file)) {
        this.fileMeta.delete(file);
        continue;
      }
      this.fileMeta.set(file, meta), !(meta.invalidProject || now - meta.lastActivityAt > Math.min(this.recentWindowMs, MAX_EVENT_AGE_MS)) && out.push({
        tool: this.name,
        cwd: null,
        projectHint: meta.projectHint,
        model: meta.model,
        lastActivityAt: meta.lastActivityAt,
        observedAt: meta.lastActivityAt,
        tokensInputDelta: usage.totalInput,
        tokensOutputDelta: usage.totalOutput,
        usage: usage.toList(),
        confidence: "activity"
      });
    }
    return signal?.aborted ? [] : out;
  }
};

// src/adapters/codex.ts
var emptyMeta = (generation) => ({
  generation,
  invalidProject: !1,
  contextModel: null,
  contextProject: null,
  contextAt: 0,
  model: null,
  projectHint: null,
  input: null,
  output: null,
  counterAt: 0,
  lastActivityAt: 0
}), CodexAdapter = class {
  constructor(recentWindowMs) {
    this.recentWindowMs = recentWindowMs;
  }
  recentWindowMs;
  name = "codex";
  tailer = new JsonlTailer("codex");
  fileMeta = /* @__PURE__ */ new Map();
  clear() {
    this.tailer.clear(), this.fileMeta.clear();
  }
  async poll(now = Date.now(), signal) {
    let files = this.tailer.files(signal), present = new Set(files);
    for (let file of this.fileMeta.keys()) present.has(file) || this.fileMeta.delete(file);
    let out = [];
    for (let file of files) {
      if (signal?.aborted) break;
      let meta = this.fileMeta.get(file), usage = new UsageAccumulator();
      if (this.tailer.readNewLines(file, (raw, generation) => {
        let line = objectRecord(raw), payload = objectRecord(line?.payload), at = eventTime(line?.timestamp, now, this.recentWindowMs);
        if (!line || !payload || at === null) return;
        if (line.type === "turn_context") {
          if ((!meta || meta.generation !== generation) && (meta = emptyMeta(generation)), at < meta.contextAt) return;
          let project = folderFromCwd(payload.cwd);
          (!project || meta.contextProject !== null && meta.contextProject !== project) && (meta.invalidProject = !0), meta.contextModel = safeModel(payload.model, "codex"), meta.contextProject = project, meta.contextAt = at;
          return;
        }
        if (line.type !== "event_msg" || payload.type !== "token_count") return;
        let info = objectRecord(payload.info), total = objectRecord(info?.total_token_usage);
        if (!total || !isCount(total.input_tokens, 1e12) || !isCount(total.output_tokens, 1e12) || ((!meta || meta.generation !== generation) && (meta = emptyMeta(generation)), at < meta.counterAt)) return;
        let input = total.input_tokens, output = total.output_tokens, baseline = meta.input === null || meta.output === null || input < meta.input || output < meta.output, inputDelta = baseline ? 0 : input - meta.input, outputDelta = baseline ? 0 : output - meta.output;
        if (meta.input = input, meta.output = output, meta.counterAt = at, baseline || meta.invalidProject || !(inputDelta || outputDelta)) return;
        let hasContext = meta.contextProject !== null && now - meta.contextAt <= MAX_EVENT_AGE_MS;
        if (!hasContext) return;
        let model = meta.contextModel;
        usage.add(model, inputDelta, outputDelta) && (meta.model = model, meta.projectHint = hasContext ? meta.contextProject : null, meta.lastActivityAt = Math.max(meta.lastActivityAt, at));
      }, signal), !meta || meta.generation !== this.tailer.generation(file)) {
        this.fileMeta.delete(file);
        continue;
      }
      this.fileMeta.set(file, meta), !(meta.invalidProject || !meta.lastActivityAt || now - meta.lastActivityAt > Math.min(this.recentWindowMs, MAX_EVENT_AGE_MS)) && out.push({
        tool: this.name,
        cwd: null,
        projectHint: meta.projectHint,
        model: meta.model,
        lastActivityAt: meta.lastActivityAt,
        observedAt: meta.lastActivityAt,
        tokensInputDelta: usage.totalInput,
        tokensOutputDelta: usage.totalOutput,
        usage: usage.toList(),
        confidence: "activity"
      });
    }
    return signal?.aborted ? [] : out;
  }
};

// src/adapters/quadcode.ts
var import_node_fs3 = __toESM(require("node:fs")), import_node_os2 = __toESM(require("node:os")), import_node_path2 = __toESM(require("node:path")), import_node_crypto5 = require("node:crypto"), import_node_util3 = require("node:util");
var MAX_QUADCODE_FILES = 64, MAX_QUADCODE_DIRECTORY_ENTRIES = 2048, MAX_QUADCODE_CHUNK_BYTES = 4 * 1024 * 1024, MAX_QUADCODE_LINE_BYTES = 1024 * 1024, MAX_QUADCODE_RECORDS_PER_FILE = 256, MAX_QUADCODE_FILE_BYTES = 256 * 1024 * 1024, MAX_SEEN_FINGERPRINTS = 4096, utf83 = new import_node_util3.TextDecoder("utf-8", { fatal: !0 }), samePath3 = (a, b) => process.platform === "win32" ? import_node_path2.default.resolve(a).toLowerCase() === import_node_path2.default.resolve(b).toLowerCase() : import_node_path2.default.resolve(a) === import_node_path2.default.resolve(b), regularFile3 = (s) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.ino > 0n && s.size >= 0n && s.size <= BigInt(MAX_QUADCODE_FILE_BYTES);
function withinHome(home, dir) {
  let a = process.platform === "win32" ? import_node_path2.default.resolve(home).toLowerCase() : import_node_path2.default.resolve(home), b = process.platform === "win32" ? import_node_path2.default.resolve(dir).toLowerCase() : import_node_path2.default.resolve(dir), rel = import_node_path2.default.relative(a, b);
  return rel === "" || !rel.startsWith("..") && !import_node_path2.default.isAbsolute(rel);
}
function quadcodeRoot(home = import_node_os2.default.homedir()) {
  if (process.platform === "darwin") return import_node_path2.default.join(home, "Library", "Application Support", "QuadcodeAI");
  let windows = process.platform === "win32", override = process.env[windows ? "APPDATA" : "XDG_CONFIG_HOME"], base = windows ? import_node_path2.default.join(home, "AppData", "Roaming") : import_node_path2.default.join(home, ".config");
  return override === void 0 || override === "" ? import_node_path2.default.join(base, "QuadcodeAI") : !import_node_path2.default.isAbsolute(override) || !withinHome(home, override) ? null : import_node_path2.default.join(override, "QuadcodeAI");
}
var safeComponent = (part) => part.length > 0 && part.length <= 200 && part !== "." && part !== ".." && !/[\x00-\x1f\x7f\\/:]/.test(part), LEVELS = [
  (p) => p === "apps",
  (p) => safeComponent(p) && safeAlias(p) !== null,
  (p) => p === ".quadcodeai",
  (p) => p === ".data",
  (p) => p === "chats",
  (p) => /^[A-Za-z0-9_-]+\.files$/.test(p)
], CHAT_FILE = /^chat_[0-9]+\.jsonl$/, QuadcodeTailer = class {
  home;
  states = /* @__PURE__ */ new Map();
  listed = /* @__PURE__ */ new Set();
  constructor(home = import_node_os2.default.homedir()) {
    this.home = home;
  }
  /**
   * Resolved per call, not frozen at construction — the same discipline
   * `rootsAllowed()` already applies to `QUADCODE_HOME`. An app-data base that
   * changes under a running daemon must be re-judged, not trusted from start-up;
   * `files()` re-lists every poll, so a root change simply re-primes at EOF.
   */
  currentRoot() {
    return quadcodeRoot(this.home);
  }
  clear() {
    this.states.clear(), this.listed.clear();
  }
  /**
   * `QUADCODE_HOME` follows the `CLAUDE_CONFIG_DIR` rule exactly: it may be set, but
   * only to the real root. Anything else makes the whole source unavailable rather
   * than redirecting the reader somewhere it was never authorised to look.
   */
  rootsAllowed(root) {
    if (root === null) return !1;
    let override = process.env.QUADCODE_HOME;
    return override && (!import_node_path2.default.isAbsolute(override) || !samePath3(override, root)) || !import_node_path2.default.isAbsolute(root) || /^(?:[\\]{2}|[/]{2})/.test(root) ? !1 : this.unlinkedDirectory(root);
  }
  unlinkedDirectory(dir) {
    try {
      let s = import_node_fs3.default.lstatSync(dir);
      return s.isDirectory() && !s.isSymbolicLink() && samePath3(import_node_fs3.default.realpathSync(dir), dir);
    } catch {
      return !1;
    }
  }
  layout(parts, isDirectory) {
    return parts.every(safeComponent) ? isDirectory ? parts.length <= LEVELS.length && parts.every((p, i) => LEVELS[i](p)) : parts.length === LEVELS.length + 1 && parts.slice(0, LEVELS.length).every((p, i) => LEVELS[i](p)) && CHAT_FILE.test(parts[LEVELS.length]) : !1;
  }
  checkedPath(file, isDirectory) {
    let root = this.currentRoot();
    if (!this.rootsAllowed(root)) return null;
    let relative = import_node_path2.default.relative(root, file);
    if (relative.startsWith("..") || import_node_path2.default.isAbsolute(relative)) return null;
    let parts = relative ? relative.split(import_node_path2.default.sep) : [];
    if (!this.layout(parts, isDirectory)) return null;
    let current = root;
    for (let part of isDirectory ? parts : parts.slice(0, -1))
      if (current = import_node_path2.default.join(current, part), !this.unlinkedDirectory(current)) return null;
    try {
      let s = import_node_fs3.default.lstatSync(file, { bigint: !0 });
      return (isDirectory ? !s.isDirectory() || s.isSymbolicLink() : !regularFile3(s)) ? null : samePath3(import_node_fs3.default.realpathSync(file), file) ? s : null;
    } catch {
      return null;
    }
  }
  /** The `<Project>` component of a listed chat file, already alias-safe, or null. */
  projectOf(file) {
    let root = this.currentRoot();
    if (root === null) return null;
    let parts = import_node_path2.default.relative(root, file).split(import_node_path2.default.sep);
    return parts.length === LEVELS.length + 1 ? safeAlias(parts[1]) : null;
  }
  /** Bounded metadata enumeration strictly inside the documented layout. */
  files(signal) {
    this.listed.clear();
    let remaining = MAX_QUADCODE_DIRECTORY_ENTRIES, candidates = [], walk = (dir, depth) => {
      if (signal?.aborted || remaining <= 0 || !this.checkedPath(dir, !0)) return;
      let handle;
      try {
        if (handle = import_node_fs3.default.opendirSync(dir, { bufferSize: 16 }), !this.checkedPath(dir, !0)) return;
        let entries = [], entry;
        for (; remaining-- > 0 && !signal?.aborted && (entry = handle.readSync()); ) entries.push(entry);
        for (let e of entries) {
          if (signal?.aborted) break;
          if (e.isSymbolicLink()) continue;
          let file = import_node_path2.default.join(dir, e.name);
          if (e.isDirectory() && depth < LEVELS.length) walk(file, depth + 1);
          else if (e.isFile() && depth === LEVELS.length) {
            let s = this.checkedPath(file, !1);
            s && candidates.push({ file, mtime: Number(s.mtimeMs) });
          }
        }
      } catch {
      } finally {
        try {
          handle?.closeSync();
        } catch {
        }
      }
    }, root = this.currentRoot();
    root !== null && walk(root, 0);
    for (let { file } of candidates.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_QUADCODE_FILES)) this.listed.add(file);
    for (let file of this.states.keys()) this.listed.has(file) || this.states.delete(file);
    return [...this.listed];
  }
  /** Emits only lines appended since the previous poll. First sight primes at EOF. */
  readNewLines(file, visit, signal) {
    if (signal?.aborted || !this.listed.has(file)) return;
    let fd;
    try {
      let before = this.checkedPath(file, !1);
      if (!before) {
        this.states.delete(file);
        return;
      }
      fd = import_node_fs3.default.openSync(file, import_node_fs3.default.constants.O_RDONLY | (import_node_fs3.default.constants.O_NOFOLLOW ?? 0) | (import_node_fs3.default.constants.O_NONBLOCK ?? 0));
      let s = import_node_fs3.default.fstatSync(fd, { bigint: !0 }), after = this.checkedPath(file, !1);
      if (!regularFile3(s) || !after || s.dev !== before.dev || s.ino !== before.ino || s.dev !== after.dev || s.ino !== after.ino || signal?.aborted) {
        this.states.delete(file);
        return;
      }
      let size = Number(s.size), cursor = this.states.get(file);
      if (!cursor || cursor.dev !== s.dev || cursor.ino !== s.ino || size < cursor.size || size === cursor.size && s.mtimeNs !== cursor.mtime || size - cursor.offset > MAX_QUADCODE_CHUNK_BYTES) {
        let skipPartial = !1;
        if (size > 0) {
          let last = Buffer.alloc(1);
          skipPartial = import_node_fs3.default.readSync(fd, last, 0, 1, size - 1) !== 1 || last[0] !== 10;
        }
        this.states.set(file, { dev: s.dev, ino: s.ino, offset: size, size, mtime: s.mtimeNs, skipPartial });
        return;
      }
      if (size <= cursor.offset) return;
      let start = cursor.offset, buffer = Buffer.alloc(size - start), bytes = import_node_fs3.default.readSync(fd, buffer, 0, buffer.length, start), current = this.checkedPath(file, !1);
      if (signal?.aborted || !current || current.dev !== s.dev || current.ino !== s.ino) {
        this.states.delete(file);
        return;
      }
      cursor.size = size, cursor.mtime = s.mtimeNs;
      let lineStart = 0, records = 0;
      for (; lineStart < bytes && !signal?.aborted; ) {
        let end = buffer.indexOf(10, lineStart);
        if (end < 0 || end >= bytes) break;
        if (!cursor.skipPartial && end - lineStart <= MAX_QUADCODE_LINE_BYTES && records++ < MAX_QUADCODE_RECORDS_PER_FILE)
          try {
            visit(JSON.parse(utf83.decode(buffer.subarray(lineStart, end))));
          } catch {
          }
        cursor.skipPartial = !1, lineStart = end + 1;
      }
      cursor.offset = start + lineStart, (cursor.skipPartial || bytes - lineStart > MAX_QUADCODE_LINE_BYTES) && (cursor.offset = start + bytes, cursor.skipPartial = !0);
    } catch {
      this.states.delete(file);
    } finally {
      if (fd !== void 0)
        try {
          import_node_fs3.default.closeSync(fd);
        } catch {
        }
    }
  }
};
function turnStartedAt(value) {
  if (typeof value != "string" || value.length > 32 || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) return null;
  let at = Date.parse(value.replace(" ", "T").slice(0, 23));
  return Number.isFinite(at) ? at : null;
}
function projectChatRecord(value, now) {
  let r = objectRecord(value);
  if (!r || r.method !== "LLM" || r.is_status_message === !0) return null;
  let startedAt = turnStartedAt(r.timestamp);
  if (startedAt === null || now - startedAt > MAX_RECORD_AGE_MS || startedAt > now + MAX_RECORD_AGE_MS) return null;
  let variation = Number.isSafeInteger(r.variation_index) && r.variation_index >= 0 && r.variation_index < 64 ? r.variation_index : 0, variations = Array.isArray(r.variations) ? r.variations : [];
  if (variations.length > 64) return null;
  let chosen = objectRecord(variations[variation]) ?? objectRecord(variations[0]);
  return { startedAt, model: safeModel(chosen?.model_name, "quadcode"), variation };
}
var QuadcodeAdapter = class {
  name = "quadcode";
  tailer;
  seen = /* @__PURE__ */ new Set();
  /**
   * `_recentWindowMs` is accepted for symmetry with the other adapters but is not
   * used: freshness here is the append observation itself, which is always `now`.
   */
  constructor(_recentWindowMs, home) {
    this.tailer = new QuadcodeTailer(home);
  }
  clear() {
    this.tailer.clear(), this.seen.clear();
  }
  /**
   * The format carries no record id, so de-duplication uses a fingerprint over bounded
   * metadata plus the record's position in the tree. This is weaker than Claude's
   * `message.id` digest and is documented as such: two LLM records in one chat sharing
   * a microsecond timestamp, model and variation index would be counted once. It
   * exists to make a re-prime or a double read idempotent, not to identify a turn.
   */
  fingerprint(file, project, turn) {
    return (0, import_node_crypto5.createHash)("sha256").update(`${project ?? ""}\0${import_node_path2.default.basename(file)}\0${turn.startedAt}\0${turn.model ?? ""}\0${turn.variation}`).digest("hex");
  }
  async poll(now = Date.now(), signal) {
    if (signal?.aborted) return [];
    let out = [];
    for (let file of this.tailer.files(signal)) {
      if (signal?.aborted) break;
      let project = this.tailer.projectOf(file), model = null, fresh = !1;
      this.tailer.readNewLines(file, (raw) => {
        let turn = projectChatRecord(raw, now);
        if (!turn) return;
        let digest = this.fingerprint(file, project, turn);
        this.seen.has(digest) || (this.seen.size >= MAX_SEEN_FINGERPRINTS && this.seen.delete(this.seen.values().next().value), this.seen.add(digest), fresh = !0, model = turn.model);
      }, signal), !(!fresh || signal?.aborted) && out.push({
        tool: this.name,
        cwd: null,
        projectHint: project,
        model,
        confidence: "activity",
        lastActivityAt: now,
        observedAt: now,
        tokensInputDelta: 0,
        tokensOutputDelta: 0,
        usage: []
      });
    }
    return signal?.aborted ? [] : out;
  }
};

// src/detector.ts
var ADAPTER_POLL_TIMEOUT_MS = 45e3, busyAdapters = /* @__PURE__ */ new WeakSet(), newest = (list) => list.reduce(
  (best, observation) => !best || observation.lastActivityAt > best.lastActivityAt ? observation : best,
  null
), hasTokens = (o) => o.tokensInputDelta > 0 || o.tokensOutputDelta > 0, usageKey = (tool, model) => `${tool}\0${model ?? ""}`;
async function pollAdapter(adapter, timeoutMs = ADAPTER_POLL_TIMEOUT_MS, now = Date.now(), signal) {
  if (signal?.aborted || busyAdapters.has(adapter)) return [];
  let controller = new AbortController(), timer, finishCancelled, cancel = () => {
    controller.abort(), finishCancelled?.();
  };
  signal?.addEventListener("abort", cancel, { once: !0 }), busyAdapters.add(adapter);
  try {
    let cancelled = new Promise((resolve3) => {
      finishCancelled = () => resolve3([]), timer = setTimeout(() => {
        console.warn("tracker: AI source poll timed out; unavailable this tick"), cancel();
      }, timeoutMs);
    }), poll = Promise.resolve().then(() => adapter.poll(now, controller.signal)).finally(() => busyAdapters.delete(adapter)), result = await Promise.race([poll, cancelled]);
    return controller.signal.aborted || !Array.isArray(result) ? [] : result.slice(0, MAX_LOG_FILES);
  } catch {
    return console.warn("tracker: AI source poll failed; unavailable this tick"), [];
  } finally {
    clearTimeout(timer), signal?.removeEventListener("abort", cancel);
  }
}
function projectObservation(o, now, windowMs) {
  if (!o || !isSupportedTool(o.tool) || o.confidence !== "activity" || o.cwd !== null || !Number.isSafeInteger(o.lastActivityAt) || o.lastActivityAt < now - windowMs || o.lastActivityAt > now + MAX_FUTURE_SKEW_MS || !Array.isArray(o.usage) || o.usage.length > MAX_USAGE_ENTRIES) return null;
  let usage = [];
  for (let entry of o.usage) {
    let u = projectUsage({
      tool: o.tool,
      model: entry?.model,
      tokensInputDelta: entry?.tokensInputDelta,
      tokensOutputDelta: entry?.tokensOutputDelta,
      estimated: entry?.estimated
    });
    if (!u) return null;
    usage.push({ model: u.model, tokensInputDelta: u.tokensInputDelta, tokensOutputDelta: u.tokensOutputDelta });
  }
  let input = usage.reduce((n, u) => n + u.tokensInputDelta, 0), output = usage.reduce((n, u) => n + u.tokensOutputDelta, 0);
  return !isCount(input) || !isCount(output) || input !== o.tokensInputDelta || output !== o.tokensOutputDelta ? null : {
    tool: o.tool,
    model: safeModel(o.model, o.tool),
    cwd: null,
    projectHint: safeAlias(o.projectHint),
    confidence: "activity",
    lastActivityAt: Math.min(now, o.lastActivityAt),
    observedAt: Math.min(now, o.lastActivityAt),
    tokensInputDelta: input,
    tokensOutputDelta: output,
    usage
  };
}
var Detector = class {
  constructor(activeWindowMs, adapterTimeoutMs = ADAPTER_POLL_TIMEOUT_MS, attestedTools = []) {
    this.adapterTimeoutMs = adapterTimeoutMs;
    this.activeWindowMs = Math.min(Math.max(1, activeWindowMs), MAX_EVENT_AGE_MS), this.adapters = [
      new ClaudeCodeAdapter(this.activeWindowMs),
      new CodexAdapter(this.activeWindowMs),
      new QuadcodeAdapter(this.activeWindowMs)
    ];
    for (let adapter of this.adapters) this.origin.set(adapter, (tool) => tool === adapter.name);
    let accepted = attestedTools.filter(isAttestedTool);
    if (accepted.length) {
      let receiver = new AttestedMetadataAdapter(this.activeWindowMs, accepted);
      this.origin.set(receiver, isAttestedTool), this.adapters.push(receiver);
    }
  }
  adapterTimeoutMs;
  adapters;
  /**
   * Which tool ids each adapter is permitted to speak for.
   *
   * Round 4 tightened this from a category rule to an exact one. `quadcode` is now
   * both natively collected and receiver-eligible, so "is it a native tool" no longer
   * distinguishes anything: a category check would have let the Claude adapter speak
   * for Quadcode. Each log adapter may therefore emit ONLY its own `name`, and the
   * receiver only `ATTESTED_TOOLS`. The default for an adapter injected later
   * (fixtures, tests) is the same exact-name rule, which is strictly narrower than
   * the category default it replaces.
   */
  origin = /* @__PURE__ */ new WeakMap();
  cancellation = null;
  generation = 0;
  activeWindowMs;
  clear() {
    this.generation += 1, this.cancellation?.abort();
    for (let adapter of this.adapters) adapter.clear?.();
  }
  async detect(now = Date.now(), current, allowed = () => !0, signal) {
    let generation = this.generation, controller = new AbortController();
    this.cancellation?.abort(), this.cancellation = controller;
    let cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: !0 }), signal?.aborted && cancel();
    let adapters = [...this.adapters], results;
    try {
      results = await Promise.all(adapters.map((a) => pollAdapter(a, this.adapterTimeoutMs, now, controller.signal)));
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
    if (controller.signal.aborted || generation !== this.generation) return null;
    let all = results.flatMap((list, index) => {
      let adapter = adapters[index], mayEmit = this.origin.get(adapter) ?? ((tool) => tool === adapter.name);
      return list.filter((o) => mayEmit(o?.tool));
    }).map((o) => projectObservation(o, now, this.activeWindowMs)).filter((o) => o !== null).filter(allowed);
    if (!all.length) return null;
    let usage = /* @__PURE__ */ new Map(), input = 0, output = 0;
    for (let o of all) for (let u of o.usage) {
      if (!(u.tokensInputDelta || u.tokensOutputDelta)) continue;
      let key = usageKey(o.tool, u.model);
      if (!usage.has(key) && usage.size >= MAX_USAGE_ENTRIES || !isCount(input + u.tokensInputDelta) || !isCount(output + u.tokensOutputDelta)) continue;
      let previous = usage.get(key);
      usage.set(key, {
        tool: o.tool,
        model: u.model,
        tokensInputDelta: (previous?.tokensInputDelta ?? 0) + u.tokensInputDelta,
        tokensOutputDelta: (previous?.tokensOutputDelta ?? 0) + u.tokensOutputDelta
      }), input += u.tokensInputDelta, output += u.tokensOutputDelta;
    }
    let seen = /* @__PURE__ */ new Map();
    for (let o of all)
      for (let model of /* @__PURE__ */ new Set([o.model, ...o.usage.map((u) => u.model)])) {
        let key = usageKey(o.tool, model);
        (!seen.has(key) || seen.get(key).lastSeenAt < o.lastActivityAt) && seen.set(key, { tool: o.tool, model, lastSeenAt: o.lastActivityAt, cwd: null, projectHint: o.projectHint });
      }
    let pick = null;
    if (current && !all.some((o) => o.tool !== current.tool && hasTokens(o))) {
      let same = all.filter((o) => o.tool === current.tool), inProject = same.filter((o) => o.projectHint === current.projectHint);
      pick = newest(inProject.filter(hasTokens)) ?? newest(same.filter(hasTokens)) ?? newest(inProject) ?? newest(same);
    }
    return pick ??= newest(all.filter(hasTokens)) ?? newest(all), pick ? {
      tool: pick.tool,
      model: pick.model,
      cwd: null,
      projectHint: pick.projectHint,
      active: !0,
      lastActivityAt: pick.lastActivityAt,
      tokensInputDelta: input,
      tokensOutputDelta: output,
      usage: [...usage.values()],
      seen: [...seen.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, MAX_USAGE_ENTRIES)
    } : null;
  }
};

// src/projectAlias.ts
var HIDDEN = "hidden", UNKNOWN_PROJECT_ALIAS = "unknown";
function resolveProjectAlias(cwd, config, hint = null) {
  let folder = folderFromCwd(cwd) ?? safeAlias(hint), matches = folder ? Object.entries(config.projectAliases ?? {}).filter(([key]) => key.toLowerCase() === folder.toLowerCase()).map(([, value]) => value) : [];
  return matches.includes(HIDDEN) ? null : (matches.length === 1 ? safeAlias(matches[0]) : null) ?? UNKNOWN_PROJECT_ALIAS;
}

// src/statusFile.ts
var OFFLINE_STATUS = {
  collectionPolicy: COLLECTION_POLICY,
  connected: !1,
  status: "offline",
  projectAlias: null,
  tool: null,
  model: null,
  sessionStartedAt: null,
  updatedAt: (/* @__PURE__ */ new Date(0)).toISOString(),
  sources: []
};
function iso(value) {
  if (typeof value != "string" || value.length !== 24) return null;
  let at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value ? value : null;
}
function projectStatus(value) {
  let s = objectRecord(value);
  if (!s) return { ...OFFLINE_STATUS };
  let active = s.status === "active" && isSupportedTool(s.tool) && safeAlias(s.projectAlias) !== null, sources = [];
  if (active && Array.isArray(s.sources)) for (let raw of s.sources.slice(0, MAX_USAGE_ENTRIES)) {
    let source = objectRecord(raw);
    !source || !isSupportedTool(source.tool) || eventTime(source.lastSeenAt, Date.now(), MAX_EVENT_AGE_MS) === null || sources.push({ tool: source.tool, model: safeModel(source.model, source.tool), lastSeenAt: new Date(eventTime(source.lastSeenAt, Date.now(), MAX_EVENT_AGE_MS)).toISOString() });
  }
  return {
    collectionPolicy: COLLECTION_POLICY,
    ...typeof s.configFingerprint == "string" && /^[a-f0-9]{64}$/.test(s.configFingerprint) ? { configFingerprint: s.configFingerprint } : {},
    // Constructed, never spread: a stale file cannot claim the receiver is on.
    ...typeof s.attestedReceiver == "boolean" ? { attestedReceiver: s.attestedReceiver } : {},
    connected: s.connected === !0 && iso(s.lastConnectionSeenAt) !== null && eventTime(s.lastConnectionSeenAt, Date.now(), 9e4) !== null,
    ...iso(s.lastConnectionCheckAt) ? { lastConnectionCheckAt: iso(s.lastConnectionCheckAt) } : {},
    ...iso(s.lastConnectionSeenAt) ? { lastConnectionSeenAt: iso(s.lastConnectionSeenAt) } : {},
    status: active ? "active" : s.status === "offline" ? "offline" : "idle",
    projectAlias: active ? safeAlias(s.projectAlias) : null,
    tool: active ? s.tool : null,
    model: active ? safeModel(s.model, s.tool) : null,
    sessionStartedAt: active ? iso(s.sessionStartedAt) : null,
    updatedAt: iso(s.updatedAt) ?? (/* @__PURE__ */ new Date(0)).toISOString(),
    ...typeof s.authRejected == "boolean" ? { authRejected: s.authRejected } : {},
    sources
  };
}
function readStatus() {
  let raw = objectRecord(readJson(STATUS_PATH)), config = readConfig();
  return !raw || raw.collectionPolicy !== COLLECTION_POLICY || !config || raw.configFingerprint !== configFingerprint(config) ? { ...OFFLINE_STATUS } : projectStatus(raw);
}
function writeStatus(status) {
  writeJsonAtomic(STATUS_PATH, projectStatus(status));
}
function writeOfflineStatus() {
  let config = readConfig();
  writeStatus({ ...OFFLINE_STATUS, ...config ? { configFingerprint: configFingerprint(config) } : {}, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
}
function markAuthRejected(rejected) {
  let config = readConfig();
  if (!config) return;
  let current = rejected ? OFFLINE_STATUS : readStatus();
  writeStatus({
    ...current,
    configFingerprint: configFingerprint(config),
    authRejected: rejected,
    ...rejected ? { connected: !1 } : {},
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}

// src/stopRequest.ts
var fs5 = __toESM(require("node:fs"));
function requestStop() {
  writeJsonAtomic(STOP_REQUEST_PATH, { requestedAt: (/* @__PURE__ */ new Date()).toISOString(), byPid: process.pid });
}
function isStopRequested() {
  return fs5.existsSync(STOP_REQUEST_PATH);
}
function clearStopRequest() {
  removeFile(STOP_REQUEST_PATH);
}

// src/heartbeat.ts
var STOP_REQUEST_POLL_MS = 1e3, IN_FLIGHT_GRACE_MS = 3e3;
function createLoopState(config) {
  let valid = projectConfig(config), activeWindowMs = valid ? idleThresholdMs(valid) : 3e5, attestedTools = valid ? attestedToolsFor(valid) : [];
  return {
    activeSession: null,
    lastActivityAt: null,
    detector: new Detector(activeWindowMs, void 0, attestedTools),
    pendingUsage: /* @__PURE__ */ new Map(),
    sourcesSeen: /* @__PURE__ */ new Map(),
    modelChallenger: null,
    activeWindowMs,
    attestedTools,
    stopping: !1,
    epoch: 0,
    binding: valid ? configFingerprint(valid) : null,
    requestAbort: null,
    loadConfig: readConfig
  };
}
function clearCollectedState(state, config) {
  state.epoch += 1, state.requestAbort?.abort(), state.requestAbort = null, state.detector.clear(), state.activeSession = null, state.lastActivityAt = null, state.pendingUsage.clear(), state.sourcesSeen.clear(), state.modelChallenger = null, state.binding = config ? configFingerprint(config) : null;
  let nextTools = config ? attestedToolsFor(config) : [], consentChanged = nextTools.join("\0") !== state.attestedTools.join("\0");
  config && (idleThresholdMs(config) !== state.activeWindowMs || consentChanged) ? (state.activeWindowMs = idleThresholdMs(config), state.attestedTools = nextTools, state.detector = new Detector(state.activeWindowMs, void 0, nextTools)) : !config && state.attestedTools.length && (state.attestedTools = [], state.detector = new Detector(state.activeWindowMs));
}
function sameConfig(config, load) {
  try {
    let current = projectConfig(load());
    return current !== null && configFingerprint(current) === configFingerprint(config);
  } catch {
    return !1;
  }
}
async function requestTracker(apiUrl, deviceToken, payload, signal, retiring = !1) {
  let origin = safeApiOrigin(apiUrl);
  if (!origin || !safeDeviceToken(deviceToken) || signal?.aborted) return { ok: !1, authRejected: !1 };
  let controller = new AbortController(), cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: !0 });
  let timer = setTimeout(cancel, 15e3);
  try {
    let res = await fetch(`${origin}/api/v1/tracker/${payload ? "heartbeat" : "connection"}`, {
      method: retiring ? "DELETE" : "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${deviceToken}`, ...payload ? { "Content-Type": "application/json" } : {} },
      ...payload ? { body: JSON.stringify(payload) } : {},
      signal: controller.signal
    }), authRejected = res.status === 401 || res.status === 403;
    if (!payload && res.ok) {
      let receipt = objectRecord(await res.json()), at = typeof receipt?.lastSeenAt == "string" ? eventTime(receipt.lastSeenAt, Date.now(), 9e4) : null, valid = receipt?.protocol === "connection-v1" && receipt.connected === !retiring && (retiring && receipt.lastSeenAt === null || at !== null);
      return {
        ok: !controller.signal.aborted && valid,
        authRejected: !1,
        ...valid && !retiring && at !== null ? { connectionLastSeenAt: new Date(at).toISOString() } : {}
      };
    }
    try {
      await res.body?.cancel();
    } catch {
    }
    return { ok: !controller.signal.aborted && res.ok, authRejected };
  } catch {
    return { ok: !1, authRejected: !1 };
  } finally {
    clearTimeout(timer), signal?.removeEventListener("abort", cancel);
  }
}
async function postHeartbeat(apiUrl, deviceToken, payload, signal) {
  let safe = projectHeartbeat(payload);
  return safe ? requestTracker(apiUrl, deviceToken, safe, signal) : { ok: !1, authRejected: !1 };
}
function verifyConnection(config, signal) {
  return requestTracker(config.apiUrl, config.deviceToken, void 0, signal);
}
function retireConnection(config, signal) {
  return requestTracker(config.apiUrl, config.deviceToken, void 0, signal, !0);
}
async function sendOrQueue(config, payload) {
  let safe = projectConfig(config);
  if (!safe || !sameConfig(safe, readConfig)) return;
  let result = await postHeartbeat(safe.apiUrl, safe.deviceToken, payload);
  sameConfig(safe, readConfig) && (result.ok || result.authRejected) && markAuthRejected(result.authRejected);
}
function sessionEvent(eventType, session, occurredAt) {
  return { eventType, projectAlias: session.projectAlias, tool: session.tool, model: session.model, occurredAt };
}
function buildTools(state, config) {
  let session = state.activeSession;
  if (!session) return [];
  let tools = /* @__PURE__ */ new Map([[session.tool, {
    tool: session.tool,
    model: session.model,
    projectAlias: session.projectAlias
  }]]);
  for (let source of state.sourcesSeen.values()) {
    if (!isSupportedTool(source.tool) || tools.has(source.tool)) continue;
    let alias = resolveProjectAlias(null, config, source.projectHint ?? null);
    alias !== null && tools.set(source.tool, { tool: source.tool, model: safeModel(source.model, source.tool), projectAlias: alias });
  }
  return [...tools.values()];
}
function writeSnapshot(state, config, connected, rejected = !1, receipt) {
  let now = (/* @__PURE__ */ new Date()).toISOString(), session = connected ? state.activeSession : null;
  writeStatus({
    configFingerprint: config ? configFingerprint(config) : void 0,
    connected,
    attestedReceiver: config ? attestedToolsFor(config).length > 0 : !1,
    lastConnectionCheckAt: now,
    lastConnectionSeenAt: connected ? receipt : void 0,
    status: connected ? session ? "active" : "idle" : "offline",
    projectAlias: session?.projectAlias ?? null,
    tool: session?.tool ?? null,
    model: session?.model ?? null,
    sessionStartedAt: session?.startedAt ?? null,
    updatedAt: now,
    authRejected: rejected,
    sources: session ? [...state.sourcesSeen.values()].map((s) => ({
      tool: s.tool,
      model: s.model,
      lastSeenAt: new Date(s.lastSeenAt).toISOString()
    })) : []
  });
}
async function tick(config, state) {
  if (state.stopping) return;
  let safe = projectConfig(config);
  if (!safe || !sameConfig(safe, state.loadConfig)) {
    clearCollectedState(state), writeSnapshot(state, void 0, !1);
    return;
  }
  state.binding !== configFingerprint(safe) && clearCollectedState(state, safe), state.requestAbort?.abort();
  let controller = new AbortController();
  state.requestAbort = controller;
  let epoch = ++state.epoch, allowed = () => state.stopping || controller.signal.aborted || state.epoch !== epoch ? !1 : sameConfig(safe, state.loadConfig) ? !0 : (clearCollectedState(state), writeSnapshot(state, void 0, !1), !1), failed = (result) => {
    clearCollectedState(state, safe), writeSnapshot(state, safe, !1, result.authRejected);
  }, send = async (payload) => {
    if (!allowed()) return !1;
    let result = await postHeartbeat(safe.apiUrl, safe.deviceToken, payload, controller.signal);
    return allowed() ? result.ok ? !0 : (failed(result), !1) : !1;
  };
  try {
    let connection = await verifyConnection(safe, controller.signal);
    if (!allowed()) return;
    if (!connection.ok) {
      failed(connection);
      return;
    }
    let current = state.activeSession ? { tool: state.activeSession.tool, cwd: null, projectHint: state.activeSession.projectHint } : void 0, detection = await state.detector.detect(
      Date.now(),
      current,
      (o) => resolveProjectAlias(null, safe, o.projectHint) !== null,
      controller.signal
    );
    if (!allowed()) return;
    state.pendingUsage.clear(), state.sourcesSeen.clear(), state.modelChallenger = null;
    let now = (/* @__PURE__ */ new Date()).toISOString(), alias = detection ? resolveProjectAlias(null, safe, detection.projectHint) : null;
    if (!detection || !detection.active || alias === null || !isSupportedTool(detection.tool)) {
      if (state.activeSession && !await send(sessionEvent("session_end", state.activeSession, now))) return;
      state.activeSession = null, state.lastActivityAt = null, allowed() && writeSnapshot(state, safe, !0, !1, connection.connectionLastSeenAt);
      return;
    }
    for (let s of detection.seen) state.sourcesSeen.set(`${s.tool}\0${s.model ?? ""}`, {
      tool: s.tool,
      model: s.model,
      lastSeenAt: s.lastSeenAt,
      cwd: null,
      projectHint: s.projectHint ?? null
    });
    let model = safeModel(detection.model, detection.tool);
    if (!state.activeSession || state.activeSession.tool !== detection.tool || state.activeSession.projectAlias !== alias || state.activeSession.model !== model) {
      if (state.activeSession && !await send(sessionEvent("session_end", state.activeSession, now))) return;
      let session = {
        tool: detection.tool,
        model,
        projectAlias: alias,
        startedAt: now,
        cwd: null,
        projectHint: detection.projectHint
      };
      if (!await send(sessionEvent("session_start", session, now))) return;
      state.activeSession = session;
    }
    if (!await send({
      eventType: "heartbeat",
      projectAlias: alias,
      tool: detection.tool,
      model,
      tokensInputDelta: detection.tokensInputDelta,
      tokensOutputDelta: detection.tokensOutputDelta,
      usage: detection.usage,
      tools: buildTools(state, safe),
      occurredAt: now
    })) return;
    state.lastActivityAt = detection.lastActivityAt, allowed() && writeSnapshot(state, safe, !0, !1, connection.connectionLastSeenAt);
  } finally {
    state.requestAbort === controller && (state.requestAbort = null);
  }
}
function settleWithin(promise, ms) {
  return new Promise((resolve3) => {
    let timer = setTimeout(resolve3, ms), done = () => {
      clearTimeout(timer), resolve3();
    };
    promise.then(done, done);
  });
}
var MIN_TICK_WATCHDOG_MS = 9e4, tickWatchdogMs = (intervalMs) => Math.max(3 * intervalMs, MIN_TICK_WATCHDOG_MS), LIVE_FIELDS = ["apiUrl", "deviceToken", "projectAliases", "idleThresholdMs", "attestedMetadata"];
function refreshConfig(active, loaded) {
  let next = projectConfig(loaded);
  if (!next) return { config: active, changed: [], paused: !0 };
  let changed = LIVE_FIELDS.filter((field) => field === "projectAliases" ? JSON.stringify(next.projectAliases) !== JSON.stringify(active.projectAliases ?? {}) : field === "idleThresholdMs" ? idleThresholdMs(next) !== idleThresholdMs(active) : field === "attestedMetadata" ? attestedToolsFor(next).join("\0") !== attestedToolsFor(active).join("\0") : next[field] !== active[field]);
  return { config: changed.length ? next : active, changed: [...changed], paused: !1 };
}
function runLoop(initialConfig, options = {}) {
  let loadConfig = options.loadConfig ?? readConfig, runTick = options.runTick ?? tick, config = initialConfig, state = createLoopState(config);
  state.loadConfig = loadConfig;
  let intervalMs = heartbeatIntervalMs(config), watchdogMs = options.watchdogMs ?? tickWatchdogMs(intervalMs), inFlight = null, ticks = 0, stopRequestSeen = !1, checkStopRequest = () => stopRequestSeen || state.stopping ? !0 : isStopRequested() ? (stopRequestSeen = !0, state.epoch += 1, state.requestAbort?.abort(), state.detector.clear(), console.log("tracker: stop requested (stop.request found)"), options.onStopRequest?.(), !0) : !1, safeTick = () => {
    if (state.stopping || checkStopRequest()) return;
    let loaded = null;
    try {
      loaded = loadConfig();
    } catch {
    }
    let refreshed = refreshConfig(config, loaded);
    if (refreshed.paused) {
      clearCollectedState(state), inFlight = null, writeSnapshot(state, void 0, !1);
      return;
    }
    if (refreshed.changed.length && (console.log(`tracker: config.json changed (${refreshed.changed.join(", ")}); applied without a restart`), clearCollectedState(state, refreshed.config), inFlight = null), config = refreshed.config, inFlight) {
      if (Date.now() - inFlight.startedAt <= watchdogMs) return;
      console.warn(`tracker: tick #${inFlight.seq} exceeded watchdog ${watchdogMs} ms; cancelling it`), clearCollectedState(state, config), inFlight = null;
    }
    let startedAt = Date.now(), mine = { seq: ++ticks, startedAt, done: Promise.resolve().then(() => runTick(config, state)).catch(() => {
      inFlight === mine && (console.error("tracker: heartbeat tick failed; collection paused"), clearCollectedState(state), writeSnapshot(state, void 0, !1));
    }).finally(() => {
      inFlight === mine ? inFlight = null : console.warn(`tracker: cancelled tick #${mine.seq} finished late`);
    }) };
    inFlight = mine;
  };
  safeTick();
  let interval = setInterval(safeTick, intervalMs), stopWatch = setInterval(checkStopRequest, STOP_REQUEST_POLL_MS);
  return { stop: async () => {
    clearInterval(interval), clearInterval(stopWatch), state.stopping = !0, state.epoch += 1, state.requestAbort?.abort(), state.detector.clear(), inFlight && await settleWithin(inFlight.done, IN_FLIGHT_GRACE_MS), state.activeSession && sameConfig(config, loadConfig) && await postHeartbeat(config.apiUrl, config.deviceToken, sessionEvent("session_end", state.activeSession, (/* @__PURE__ */ new Date()).toISOString()), AbortSignal.timeout(2e3)), sameConfig(config, loadConfig) && await retireConnection(config, AbortSignal.timeout(2e3)), clearCollectedState(state), writeOfflineStatus(), clearStopRequest();
  } };
}

// src/staleDaemon.ts
var known = (value) => typeof value == "number" && Number.isFinite(value);
function isStaleDaemon(inputs) {
  let { binMtimeMs, startedAtMs, configMtimeMs, authRejected } = inputs;
  return known(startedAtMs) ? known(binMtimeMs) && binMtimeMs > startedAtMs ? "older-build" : authRejected && known(configMtimeMs) && configMtimeMs > startedAtMs ? "revoked-token" : null : null;
}
var STALE_DAEMON_EXPLANATION = {
  // mtime says "installed after the daemon started", not "different build": re-running
  // the one-liner with a byte-identical bundle trips this too (round 12), so the sentence
  // must be true in both cases.
  "older-build": "it was started before the tracker was last installed on this machine",
  "revoked-token": "the server is rejecting its token and it has never read the newer one in config.json"
};
function serveTakeoverReason(inputs) {
  let stale = isStaleDaemon(inputs);
  return stale || (inputs.mode === "serve" ? null : "manual");
}
var SERVE_TAKEOVER_EXPLANATION = {
  ...STALE_DAEMON_EXPLANATION,
  manual: "it was started by hand and nothing would restart it after a crash or a reboot"
};

// src/daemon.ts
var STOP_WAIT_MS = 8e3, STOP_POLL_MS = 200, SERVE_CLAIM_SETTLE_MS = 300, sleep = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
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
function fileMtimeMs(filePath) {
  try {
    return fs6.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}
function staleDaemonInputs(entryPath) {
  let startedAt = readJson(PID_PATH)?.startedAt, startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  return {
    binMtimeMs: fileMtimeMs(entryPath),
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
    configMtimeMs: fileMtimeMs(CONFIG_PATH),
    authRejected: readStatus().authRejected === !0
  };
}
function reportAlreadyRunning(pid) {
  console.log(`Tracker is already running (pid ${pid}).`), readStatus().authRejected === !0 && (console.log("Connected: no - the server rejects its token."), console.log("  Fix: run the install command from VibeHub (Settings > Tracker) again, then `start`."));
}
async function startDaemon(entryPath) {
  let existing = daemonStatus();
  if (existing.running) {
    let stale = isStaleDaemon(staleDaemonInputs(entryPath));
    if (!stale) {
      reportAlreadyRunning(existing.pid);
      return;
    }
    console.log(`Tracker is running (pid ${existing.pid}), but ${STALE_DAEMON_EXPLANATION[stale]}.`), console.log("Replacing it."), await stopDaemon();
    let after = daemonStatus();
    if (after.running) {
      console.error(`Could not stop the old tracker (pid ${after.pid}); it is still running. Nothing was changed.`);
      return;
    }
  }
  ensureConfigDir(), clearStopRequest();
  let pid = process.platform === "win32" ? spawnDetachedWindows(entryPath) : null;
  if (pid === null && (pid = spawnDetachedDirect(entryPath)), pid === null) {
    console.error("Failed to start tracker daemon.");
    return;
  }
  writeJsonAtomic(PID_PATH, { pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }), console.log(`Tracker started (pid ${pid}). Logs: ${LOG_PATH}`);
}
function spawnDetachedDirect(entryPath) {
  let logFd = fs6.openSync(LOG_PATH, "a"), child = (0, import_node_child_process.spawn)(process.execPath, [entryPath, "run-loop"], {
    detached: !0,
    stdio: ["ignore", logFd, logFd],
    windowsHide: !0
  });
  return child.unref(), child.pid ?? null;
}
function spawnDetachedWindows(entryPath) {
  let psQuote = (s) => `'${s.replace(/'/g, "''")}'`, script = `$p = Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList @(${psQuote(`"${entryPath}"`)}, 'run-loop') -WindowStyle Hidden -PassThru; $p.Id`;
  try {
    let result = (0, import_node_child_process.spawnSync)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: !0,
      timeout: 2e4
    }), pid = Number.parseInt((result.stdout ?? "").trim(), 10);
    return result.status !== 0 || !Number.isInteger(pid) || pid <= 0 ? null : isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}
function redirectConsoleToLog() {
  ensureConfigDir();
  let out = fs6.createWriteStream(LOG_PATH, { flags: "a" });
  globalThis.console = new import_node_console.Console({ stdout: out, stderr: out });
}
async function endLingeringSession() {
  let status = readStatus();
  if (status.status !== "offline") {
    if (status.status === "active" && status.projectAlias && status.tool) {
      let config = readConfig();
      config && (await sendOrQueue(config, {
        eventType: "session_end",
        projectAlias: status.projectAlias,
        tool: status.tool,
        model: status.model,
        occurredAt: (/* @__PURE__ */ new Date()).toISOString()
      }), console.log(`Sent session_end for the interrupted session (${status.projectAlias}, ${status.tool}).`));
    }
    writeOfflineStatus();
  }
}
async function stopDaemon() {
  let { running, pid } = daemonStatus();
  if (!running || pid === null) {
    console.log("Tracker is not running."), removeFile(PID_PATH), clearStopRequest(), await endLingeringSession();
    return;
  }
  let supervised = readJson(PID_PATH)?.mode === "serve";
  requestStop();
  let deadline = Date.now() + STOP_WAIT_MS;
  for (; isProcessAlive(pid) && Date.now() < deadline; ) await sleep(STOP_POLL_MS);
  if (isProcessAlive(pid))
    try {
      process.kill(pid), console.log(`Tracker did not stop within ${STOP_WAIT_MS / 1e3}s; killed it (pid ${pid}).`);
    } catch (err) {
      console.error("Failed to stop tracker:", err);
    }
  else
    console.log(`Tracker stopped (pid ${pid}).`);
  supervised && (console.log("It was running under a supervisor (VibeHub app / launchd), which restarts it within about 30 s."), console.log("To keep it stopped: turn off Track at login in VibeHub, or run `launchctl bootout gui/$(id -u)/com.vibehub.tracker`.")), removeFile(PID_PATH), clearStopRequest(), await endLingeringSession();
}
function runForeground(config) {
  redirectConsoleToLog();
  let shuttingDown = !1, stopLoop = null, shutdown = (reason) => {
    shuttingDown || (shuttingDown = !0, console.log(`tracker: shutting down (${reason})`), (stopLoop ? stopLoop() : Promise.resolve()).catch((err) => console.error("tracker: error during shutdown:", err)).finally(() => {
      removeFile(PID_PATH), clearStopRequest(), process.exit(0);
    }));
  };
  stopLoop = runLoop(config, { onStopRequest: () => shutdown("stop.request") }).stop, process.on("SIGTERM", () => shutdown("SIGTERM")), process.on("SIGINT", () => shutdown("SIGINT"));
}
function serveInputs(entryPath) {
  return { ...staleDaemonInputs(entryPath), mode: readJson(PID_PATH)?.mode };
}
async function serveForeground(config, entryPath) {
  let existing = daemonStatus();
  if (existing.running && existing.pid !== null) {
    let reason = serveTakeoverReason(serveInputs(entryPath));
    if (!reason) {
      console.log(`Tracker is already running under a supervisor (pid ${existing.pid}); nothing to do.`);
      return;
    }
    console.log(`Tracker is running (pid ${existing.pid}), but ${SERVE_TAKEOVER_EXPLANATION[reason]}.`), console.log("Taking it over."), await stopDaemon();
    let after = daemonStatus();
    if (after.running) {
      console.error(`Could not stop the old tracker (pid ${after.pid}); it is still running. Exiting so the supervisor can retry.`), process.exitCode = 1;
      return;
    }
  }
  ensureConfigDir(), clearStopRequest(), writeJsonAtomic(PID_PATH, { pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString(), mode: "serve" }), await sleep(SERVE_CLAIM_SETTLE_MS);
  let claimed = readJson(PID_PATH);
  if (claimed?.pid !== process.pid) {
    console.log(`Another tracker claimed tracker.pid (pid ${claimed?.pid ?? "unknown"}) while this one was starting; deferring to it.`);
    return;
  }
  console.log(`Tracker serving in the foreground (pid ${process.pid}). Loop log: ${LOG_PATH}`), runForeground(config);
}

// src/hooks/inbox.ts
var fs7 = __toESM(require("node:fs"));

// src/hooks/payload.ts
var import_node_crypto6 = require("node:crypto");
var HOOKABLE_TOOLS = ["cursor", "windsurf"];
function isHookableTool(tool) {
  return tool === "cursor" || tool === "windsurf";
}
var VENDORS = {
  cursor: {
    eventField: "hook_event_name",
    // Turn completions only. `sessionStart`/`sessionEnd` were subscribed for one round and
    // are now RETIRED: a session boundary is not a turn, and `sessionEnd` in particular can
    // fire hours after the last model call, which would report activity at a moment when
    // no AI work happened. They are not in this list, so a payload claiming one is refused
    // on arrival like any other unsubscribed event (see RETIRED_EVENTS in ./install).
    events: ["afterAgentResponse", "stop"],
    // `model` is the documented base field; `model_id` is accepted because the Round 3
    // matrix recorded it, and a vendor that renames the field must not silently drop the
    // model — it would be reported as unknown rather than wrong, but unknown-by-typo is
    // still avoidable.
    modelFields: ["model_id", "model"],
    projectFields: ["workspace_roots", "workspace_root", "cwd"],
    // Cursor documents no timestamp on any hook payload, so there is nothing to read.
    timestampField: null
  },
  windsurf: {
    eventField: "agent_action_name",
    events: ["pre_user_prompt", "post_cascade_response"],
    modelFields: ["model_name"],
    projectFields: ["cwd", "workspace_root"],
    timestampField: "timestamp"
  }
};
function hookEventsFor(tool) {
  return [...VENDORS[tool].events];
}
function projectHookEvent(tool, payload, now) {
  if (!isHookableTool(tool) || !Number.isFinite(now)) return null;
  let p = objectRecord(payload);
  if (!p) return null;
  let vendor = VENDORS[tool], event = p[vendor.eventField];
  if (typeof event != "string" || !vendor.events.includes(event)) return null;
  let stamped = vendor.timestampField === null ? null : eventTime(p[vendor.timestampField], now, MAX_EVENT_AGE_MS), at = new Date(stamped ?? now);
  if (!Number.isFinite(at.getTime())) return null;
  let model = null;
  for (let field of vendor.modelFields)
    if (model = safeModel(p[field], tool), model !== null) break;
  let projectHint = projectHintFrom(p, vendor.projectFields), record = {
    v: ATTESTED_RECORD_VERSION,
    tool,
    // Fresh and random per event: no vendor identifier — not even a digest of one —
    // reaches the file. The cost is that a vendor retrying the identical hook
    // invocation is two records rather than one; these tools carry no token counts, so
    // that costs a duplicate activity sighting and nothing measurable.
    recordId: (0, import_node_crypto6.randomUUID)(),
    occurredAt: at.toISOString(),
    model
  };
  return projectHint !== null && (record.projectHint = projectHint), record;
}
function projectHintFrom(p, fields) {
  for (let field of fields) {
    let value = p[field], candidate = Array.isArray(value) ? value.find((entry) => typeof entry == "string") : value, alias = folderFromCwd(candidate);
    if (alias !== null) return alias;
  }
  return null;
}

// src/hooks/inbox.ts
var INBOX_ROTATE_AT_BYTES = Math.min(8 * 1024 * 1024, MAX_ATTESTED_FILE_BYTES), MAX_HOOK_RECORD_BYTES = Math.min(2048, MAX_ATTESTED_LINE_BYTES), MAX_HOOK_STDIN_BYTES = 256 * 1024, HOOK_STDIN_TIMEOUT_MS = 2e3;
function appendAttestedRecord(record) {
  let line;
  try {
    line = JSON.stringify(record);
  } catch {
    return !1;
  }
  if (!line || line.includes(`
`) || Buffer.byteLength(line) > MAX_HOOK_RECORD_BYTES) return !1;
  let fd;
  try {
    ensureConfigDir();
    try {
      let existing = fs7.lstatSync(ATTESTED_PATH);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) return !1;
      existing.size >= INBOX_ROTATE_AT_BYTES && fs7.truncateSync(ATTESTED_PATH, 0);
    } catch (error) {
      if (error.code !== "ENOENT") return !1;
    }
    fd = fs7.openSync(
      ATTESTED_PATH,
      fs7.constants.O_WRONLY | fs7.constants.O_CREAT | fs7.constants.O_APPEND | (fs7.constants.O_NOFOLLOW ?? 0),
      384
    );
    let opened = fs7.fstatSync(fd);
    return !opened.isFile() || opened.nlink !== 1 ? !1 : (fs7.writeSync(fd, `${line}
`), !0);
  } catch {
    return !1;
  } finally {
    if (fd !== void 0)
      try {
        fs7.closeSync(fd);
      } catch {
      }
  }
}
function readBoundedPayload(stream, timeoutMs) {
  return new Promise((resolve3) => {
    let chunks = [], total = 0, settled = !1, parsed = () => {
      if (!chunks.length) return null;
      try {
        let text = Buffer.concat(chunks).toString("utf8");
        return text.trim() ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    }, finish = (value) => {
      if (!settled) {
        settled = !0, clearTimeout(timer), stream.removeListener("data", onData), stream.removeListener("end", onEnd), stream.removeListener("error", onEnd);
        try {
          stream.destroy?.();
        } catch {
        }
        resolve3(value);
      }
    }, onData = (chunk) => {
      let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (total += buffer.length, total > MAX_HOOK_STDIN_BYTES) {
        finish(null);
        return;
      }
      chunks.push(buffer);
      let value = parsed();
      value !== null && finish(value);
    }, onEnd = () => finish(parsed()), timer = setTimeout(() => finish(parsed()), timeoutMs);
    timer.unref?.(), stream.on("data", onData), stream.once("end", onEnd), stream.once("error", onEnd);
  });
}
async function runHookEvent(tool, stream, now = Date.now(), timeoutMs = HOOK_STDIN_TIMEOUT_MS) {
  try {
    if (!isHookableTool(tool)) return !1;
    let config = readConfig();
    if (!config || !attestedToolsFor(config).includes(tool)) return !1;
    let payload = await readBoundedPayload(stream, timeoutMs);
    if (payload === null) return !1;
    let record = projectHookEvent(tool, payload, now);
    return record === null ? !1 : appendAttestedRecord(record);
  } catch {
    return !1;
  }
}

// src/hooks/install.ts
var fs8 = __toESM(require("node:fs")), os4 = __toESM(require("node:os")), path4 = __toESM(require("node:path")), import_node_crypto7 = require("node:crypto");
var HookInstallError = class extends Error {
}, MAX_HOOK_FILE_BYTES = 256 * 1024, VENDOR_FILES = {
  cursor: {
    relativePath: [".cursor", "hooks.json"],
    required: { version: 1 },
    entry: {},
    windowsShell: "cmd"
  },
  windsurf: {
    relativePath: [".codeium", "windsurf", "hooks.json"],
    required: {},
    // Cascade shows hook output in the UI unless told otherwise; a metadata writer that
    // says nothing should also show nothing.
    entry: { show_output: !1 },
    windowsShell: "powershell"
  }
};
function vendorFor(tool) {
  if (!isHookableTool(tool))
    throw new HookInstallError(`"${String(tool)}" has no VibeHub hook. Supported: ${HOOKABLE_TOOLS.join(", ")}.`);
  return VENDOR_FILES[tool];
}
function hookFileFor(tool) {
  return path4.join(os4.homedir(), ...vendorFor(tool).relativePath);
}
function backupPathFor(tool) {
  return `${hookFileFor(tool)}.vibehub-backup`;
}
var quote = (value) => /^[A-Za-z0-9_./\\:-]+$/.test(value) ? value : `"${value}"`;
function windowsLauncher() {
  return path4.join(launcherDir(), "vibehub-tracker.cmd");
}
function hookCommandFor(tool, execPath, scriptPath) {
  let vendor = vendorFor(tool);
  if (process.platform === "win32") {
    let launcher = windowsLauncher();
    return vendor.windowsShell === "powershell" ? `& '${launcher.replace(/'/g, "''")}' hook ${tool}` : `${quote(launcher)} hook ${tool}`;
  }
  return `${quote(execPath)} ${quote(scriptPath)} hook ${tool}`;
}
function assertLauncherUsable() {
  if (process.platform !== "win32") return;
  let launcher = windowsLauncher();
  if (/[%"]/.test(launcher))
    throw new HookInstallError(
      `The command path contains a character no shell can quote safely (${launcher}). Move VibeHub to a path without % or " characters, then retry.`
    );
  if (!fs8.existsSync(launcher))
    throw new HookInstallError(
      `The vibehub-tracker command is not installed yet (${launcher} is missing). Run the VibeHub connector for Windows first - it writes that command - then retry.`
    );
}
function isOurCommand(command, tool, expected) {
  if (typeof command != "string") return !1;
  let trimmed = command.trim();
  return expected !== void 0 && trimmed === expected.trim() ? !0 : /vibehub/i.test(trimmed) && new RegExp(`(?:^|[\\s"'])hook\\s+${tool}$`).test(trimmed);
}
function readHookFile(file) {
  let fd;
  try {
    let stats = fs8.lstatSync(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1)
      throw new HookInstallError(`${file} is not a regular file. Move it aside and retry.`);
    if (stats.size > MAX_HOOK_FILE_BYTES)
      throw new HookInstallError(`${file} is unexpectedly large (${stats.size} bytes); refusing to rewrite it.`);
    fd = fs8.openSync(file, fs8.constants.O_RDONLY | (fs8.constants.O_NOFOLLOW ?? 0));
    let raw = fs8.readFileSync(fd, "utf8");
    if (raw.trim() === "") return {};
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HookInstallError(`${file} is not valid JSON. Fix or move it aside, then retry.`);
    }
    let record = objectRecord(parsed);
    if (!record) throw new HookInstallError(`${file} does not contain a JSON object. Refusing to replace it.`);
    return record;
  } catch (error) {
    if (error instanceof HookInstallError) throw error;
    if (error.code === "ENOENT") return null;
    throw new HookInstallError(`${file} could not be read (${error.code ?? "unknown error"}).`);
  } finally {
    if (fd !== void 0)
      try {
        fs8.closeSync(fd);
      } catch {
      }
  }
}
function renderPlan(tool, command, mode) {
  let vendor = vendorFor(tool), file = hookFileFor(tool), events = hookEventsFor(tool), before = readHookFile(file), existed = before !== null, root = { ...before ?? {} };
  if (existed) {
    for (let [key, value] of Object.entries(vendor.required))
      if (Object.hasOwn(root, key) && root[key] !== value)
        throw new HookInstallError(
          `${file} declares ${key}=${JSON.stringify(root[key])}, but this tracker only knows ${key}=${JSON.stringify(value)}. Update VibeHub, or add the hook by hand.`
        );
  }
  mode === "install" && Object.assign(root, vendor.required);
  let hooksValue = root.hooks === void 0 ? {} : objectRecord(root.hooks);
  if (!hooksValue) throw new HookInstallError(`${file} has a "hooks" key that is not an object. Refusing to rewrite it.`);
  let hooks2 = { ...hooksValue };
  for (let event of /* @__PURE__ */ new Set([...events, ...Object.keys(hooks2)])) {
    let current = hooks2[event];
    if (current !== void 0 && !Array.isArray(current)) {
      if (!events.includes(event)) continue;
      throw new HookInstallError(`${file} has a "hooks.${event}" that is not an array. Refusing to rewrite it.`);
    }
    let kept = (current ?? []).filter((item) => !isOurCommand(objectRecord(item)?.command, tool, command));
    if (mode === "install" && events.includes(event)) {
      let extras = process.platform === "win32" && vendor.windowsShell === "powershell" ? { ...vendor.entry, powershell: command } : vendor.entry;
      kept.push({ command, ...extras });
    }
    kept.length ? hooks2[event] = kept : Object.hasOwn(hooks2, event) && delete hooks2[event];
  }
  Object.keys(hooks2).length ? root.hooks = hooks2 : delete root.hooks;
  let content = mode === "uninstall" && Object.keys(root).every((key) => Object.hasOwn(vendor.required, key)) ? null : `${JSON.stringify(root, null, 2)}
`, previous = existed ? `${JSON.stringify(before, null, 2)}
` : null;
  return { tool, file, command, events, content, changed: content !== previous, existed };
}
function planHookInstall(tool, command) {
  return assertLauncherUsable(), renderPlan(tool, command, "install");
}
function planHookUninstall(tool, command) {
  return renderPlan(tool, command, "uninstall");
}
function applyHookPlan(plan) {
  if (!plan.changed) return;
  let directory = path4.dirname(plan.file);
  if (fs8.mkdirSync(directory, { recursive: !0 }), plan.existed && plan.content !== null) {
    let backup = backupPathFor(plan.tool);
    fs8.existsSync(backup) || fs8.copyFileSync(plan.file, backup, fs8.constants.COPYFILE_EXCL);
  }
  if (plan.content === null) {
    try {
      fs8.unlinkSync(plan.file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return;
  }
  let temporary = path4.join(directory, `.hooks.json.${(0, import_node_crypto7.randomUUID)()}.tmp`);
  try {
    fs8.writeFileSync(temporary, plan.content, { mode: 384, flag: "wx" }), fs8.renameSync(temporary, plan.file);
  } finally {
    try {
      fs8.unlinkSync(temporary);
    } catch {
    }
  }
}
function withConsent(config, tool, enabled) {
  vendorFor(tool);
  let current = attestedToolsFor(config), tools = enabled ? current.includes(tool) ? current : [...current, tool] : current.filter((entry) => entry !== tool);
  return { ...config, attestedMetadata: { enabled: tools.length > 0, tools } };
}
function setConsent(config, tool, enabled) {
  let next = withConsent(config, tool, enabled);
  return writeConfig(next), next;
}
function hookStatus(config, execPath, scriptPath) {
  let consented = attestedToolsFor(config);
  return HOOKABLE_TOOLS.map((tool) => {
    let file = hookFileFor(tool), command = hookCommandFor(tool, execPath, scriptPath), events = hookEventsFor(tool), root = null;
    try {
      root = readHookFile(file);
    } catch {
      root = null;
    }
    let hooks2 = objectRecord(root?.hooks) ?? {}, ours = (event) => Array.isArray(hooks2[event]) && hooks2[event].some((item) => isOurCommand(objectRecord(item)?.command, tool, command)), registered = events.filter(ours);
    return {
      tool,
      consented: consented.includes(tool),
      file,
      fileExists: root !== null,
      registered,
      missing: events.filter((event) => !registered.includes(event)),
      stale: Object.keys(hooks2).filter((event) => !events.includes(event) && ours(event))
    };
  });
}
var SHIM_MARK = "# vibehub-tracker shim v1 (managed by VibeHub; safe to delete)";
function launcherDir() {
  if (process.platform !== "win32") return path4.join(os4.homedir(), ".local", "bin");
  let local = process.env.LOCALAPPDATA && path4.isAbsolute(process.env.LOCALAPPDATA) ? process.env.LOCALAPPDATA : path4.join(os4.homedir(), "AppData", "Local");
  return path4.join(local, "Programs", "VibeHub");
}
function shimCandidates() {
  return process.platform === "win32" ? [path4.join(launcherDir(), "vibehub-tracker.cmd")] : [path4.join(os4.homedir(), ".local", "bin", "vibehub-tracker"), "/usr/local/bin/vibehub-tracker"];
}
function removeOwnedShims(cjsPath, candidates = shimCandidates()) {
  return candidates.map((candidate) => {
    let stats;
    try {
      stats = fs8.lstatSync(candidate);
    } catch {
      return { path: candidate, outcome: "absent" };
    }
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_HOOK_FILE_BYTES)
      return { path: candidate, outcome: "foreign", detail: "not a regular file" };
    let body = "";
    try {
      body = fs8.readFileSync(candidate, "utf8");
    } catch {
      return { path: candidate, outcome: "failed", detail: "could not be read" };
    }
    if (!body.includes(SHIM_MARK)) return { path: candidate, outcome: "foreign" };
    let home = os4.homedir().replace(/[\\/]+$/, ""), resolved = process.platform === "win32" ? body.replace(/%USERPROFILE%/gi, home).toLowerCase() : body, needle = process.platform === "win32" ? cjsPath.toLowerCase() : cjsPath;
    if (!resolved.includes(needle)) return { path: candidate, outcome: "other-install" };
    try {
      fs8.unlinkSync(candidate);
    } catch (error) {
      return {
        path: candidate,
        outcome: "failed",
        detail: error.code === "EACCES" || error.code === "EPERM" ? `needs elevation: sudo rm -f ${candidate}` : "could not be removed"
      };
    }
    return { path: candidate, outcome: "removed" };
  });
}
function inboxPresence() {
  let exists = !1;
  try {
    exists = fs8.lstatSync(ATTESTED_PATH).isFile();
  } catch {
    exists = !1;
  }
  return { path: ATTESTED_PATH, exists };
}

// src/toolLabels.ts
var TOOL_LABELS = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  vscode: "VS Code",
  windsurf: "Windsurf",
  zed: "Zed",
  quadcode: "Quadcode AI",
  chatgpt: "ChatGPT",
  grok: "Grok"
};
function toolLabel(tool) {
  return TOOL_LABELS[tool] ?? tool;
}
function describeSources(sources) {
  let byTool = /* @__PURE__ */ new Map();
  for (let s of sources) {
    let models = byTool.get(s.tool) ?? [];
    s.model && !models.includes(s.model) && models.push(s.model), byTool.set(s.tool, models);
  }
  return [...byTool.entries()].map(([tool, models]) => models.length ? `${toolLabel(tool)} (${models.join(", ")})` : toolLabel(tool)).join(", ");
}

// src/index.ts
var CONFIG_PATH_LABEL = "~/.vibehub/config.json", STATUS_PATH_LABEL = "~/.vibehub/status.json", ATTESTED_PATH_LABEL = "~/.vibehub/attested.jsonl", program2 = new Command();
program2.name("vibehub-tracker").description("VibeHub AI-session metadata tracker");
async function verifyToken(apiUrl, deviceToken) {
  try {
    let origin = safeApiOrigin(apiUrl);
    if (!origin || !safeDeviceToken(deviceToken)) return { ok: !1, rejected: !0, detail: "Invalid tracker configuration" };
    let res = await fetch(`${origin}/api/v1/tracker/verify`, {
      redirect: "error",
      headers: { Authorization: `Bearer ${deviceToken}` },
      signal: AbortSignal.timeout(15e3)
    });
    if (res.ok) {
      let body = await res.json().catch(() => ({}));
      return { ok: !0, rejected: !1, detail: body.username ? `@${body.username}` : "" };
    }
    return res.status === 401 ? { ok: !1, rejected: !0, detail: (await res.json().catch(() => ({}))).error ?? "Invalid or revoked tracker token" } : { ok: !1, rejected: !1, detail: `server returned ${res.status}` };
  } catch (err) {
    return { ok: !1, rejected: !1, detail: err instanceof Error ? err.message : "network error" };
  }
}
async function readTokenFromStdin() {
  let chunks = [], total = 0;
  for await (let chunk of process.stdin) {
    let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (total += buf.length, total > 4096) throw new Error("stdin token too long");
    chunks.push(buf);
  }
  return (Buffer.concat(chunks).toString("utf8").split(/\r?\n/, 1)[0] ?? "").trim();
}
program2.command("login [deviceToken]").description(`validate the token with the server, then write ${CONFIG_PATH_LABEL}`).option("--api-url <url>", "VibeHub server URL", DEFAULT_API_URL).option("--token-stdin", "read the device token from stdin (one line) instead of an argument").action(async (deviceTokenArg, options) => {
  let deviceToken;
  options.tokenStdin ? (deviceTokenArg && (console.error("Login failed: pass the token either as an argument or on stdin, not both."), process.exit(1)), deviceToken = await readTokenFromStdin().catch((err) => {
    console.error(`Login failed: ${err instanceof Error ? err.message : "could not read stdin"}.`), process.exit(1);
  })) : deviceTokenArg ? deviceToken = deviceTokenArg : (console.error("Login failed: missing device token. Pass it as an argument or use --token-stdin."), process.exit(1)), safeDeviceToken(deviceToken) || (console.error("Login failed: the device token is empty or malformed."), console.error("Create a new token in VibeHub > Settings > Tracker and try again."), process.exit(1));
  let verified = await verifyToken(options.apiUrl, deviceToken);
  verified.rejected && (console.error(`Login failed: token rejected by the server (${verified.detail}).`), console.error("Create a new token in VibeHub > Settings > Tracker and try again."), process.exit(1));
  let existing = readConfig(), config = {
    apiUrl: options.apiUrl,
    deviceToken,
    projectAliases: existing?.projectAliases ?? {},
    heartbeatIntervalMs: existing?.heartbeatIntervalMs,
    idleThresholdMs: existing?.idleThresholdMs,
    toolProcessNames: existing?.toolProcessNames,
    // A device-level consent setting, like projectAliases: re-running `login`
    // must not silently switch the receiver on or off behind the user's back.
    attestedMetadata: existing?.attestedMetadata
  };
  writeConfig(config), verified.ok ? console.log(`Logged in as ${verified.detail}. Wrote ${CONFIG_PATH_LABEL} (apiUrl: ${config.apiUrl}).`) : (console.log(`Wrote ${CONFIG_PATH_LABEL} (apiUrl: ${config.apiUrl}).`), console.log(`Could not verify with the server right now (${verified.detail}) - saved anyway.`), console.log("Run `vibehub-tracker status` after `start` to confirm it's actually connected."));
  let daemon = daemonStatus();
  daemon.running && (console.log(`Tracker is running (pid ${daemon.pid}): it picks up this token within 30 s.`), console.log("Run `start` anyway - it replaces a tracker started from an older build."));
});
program2.command("set <projectFolder> <alias>").description(`remap a project folder's display alias, or hide it with the literal "${HIDDEN}"`).action((projectFolder, alias) => {
  let config = requireConfig();
  config.projectAliases = { ...config.projectAliases, [projectFolder]: alias }, writeConfig(config), console.log(
    alias === HIDDEN ? `"${projectFolder}" will be hidden from presence.` : `"${projectFolder}" will be shown as "${alias}".`
  );
});
program2.command("start").description("track supported Claude Code / Codex / Quadcode AI session metadata and send heartbeats").action(async () => {
  requireConfig(), await startDaemon(path5.resolve(__filename));
});
program2.command("status").description(`pretty-print the current ${STATUS_PATH_LABEL}`).action(() => {
  let config = readConfig();
  if (!config) {
    console.log("Not logged in. Run `vibehub-tracker login <deviceToken>` first.");
    return;
  }
  let status = readStatus(), { running, pid } = daemonStatus();
  console.log(`Daemon:  ${running ? `running (pid ${pid})` : "not running"}`), console.log(`Status:  ${status.status}`), status.status === "active" && (console.log(`Project: ${status.projectAlias}`), console.log(`Tool:    ${status.tool}`), console.log(`Model:   ${status.model}`), console.log(`Started: ${status.sessionStartedAt}`)), console.log(`Updated: ${status.updatedAt}`);
  let attested2 = attestedToolsFor(config);
  console.log("Scope:   supported AI-session activity only (Claude Code, Codex, Quadcode AI)"), attested2.length > 0 && (console.log(`Receiver: on for ${attested2.map(toolLabel).join(", ")} (opt-in, ${ATTESTED_PATH_LABEL})`), console.log("          Records come from a separate producer you installed; this tracker reads"), console.log("          no log, process or window for those tools, and never estimates their usage."), console.log("          `vibehub-tracker hooks status` shows whether anything is writing them."));
  let seeingCutoff = Date.now() - MAX_EVENT_AGE_MS, seeing = (status.sources ?? []).filter((s) => Date.parse(s.lastSeenAt) >= seeingCutoff);
  seeing.length > 0 ? console.log(`Seeing:  ${describeSources(seeing)}`) : running && console.log("Seeing:  no recent supported AI usage records (AI-only idle; other apps are not observed)");
  let freshCheck = Date.parse(status.lastConnectionCheckAt ?? "") >= Date.now() - Math.max(9e4, 3 * (config.heartbeatIntervalMs ?? 3e4));
  status.authRejected ? (console.log("Connected: no - token rejected by the server."), console.log("  Create a new token in VibeHub > Settings > Tracker, then run:"), console.log("  vibehub-tracker login <newToken>")) : running ? status.connected && freshCheck ? (console.log("Connected: yes"), console.log("  Recent server-accepted daemon connection; does not imply an active AI session.")) : console.log("Connected: not yet - waiting for a successful daemon connection check; no AI activity is required.") : console.log("Connected: no - daemon isn't running. Run `vibehub-tracker start`.");
});
program2.command("stop").description("stop the running tracker daemon (waits for it to end the session cleanly)").action(async () => {
  await stopDaemon();
});
program2.command("logout").description(`stop the daemon and remove ${CONFIG_PATH_LABEL}`).action(async () => {
  await stopDaemon(), deleteConfig(), writeOfflineStatus(), console.log(`Logged out. Removed ${CONFIG_PATH_LABEL}.`);
});
program2.command("uninstall").description("remove what this install owns: the hooks it wrote, its consent, its config and the `vibehub-tracker` command").action(async () => {
  let config = readConfig(), script = path5.resolve(__filename);
  if (await stopDaemon(), config)
    for (let tool of HOOKABLE_TOOLS)
      try {
        let plan = planHookUninstall(tool, hookCommandFor(tool, process.execPath, script));
        applyHookPlan(plan), plan.changed && console.log(`Removed the VibeHub hook from ${plan.file}.`);
      } catch (error) {
        console.log(`Left ${toolLabel(tool)}'s hook file alone: ${error instanceof Error ? error.message : "unreadable"}`);
      }
  for (let removal of removeOwnedShims(script))
    switch (removal.outcome) {
      case "removed":
        console.log(`Removed ${removal.path}.`);
        break;
      case "foreign":
        console.log(`Left ${removal.path} alone - it is not VibeHub's.`);
        break;
      case "other-install":
        console.log(`Left ${removal.path} alone - it belongs to another VibeHub install.`);
        break;
      case "failed":
        console.log(`Could not remove ${removal.path}${removal.detail ? ` - ${removal.detail}` : ""}.`);
        break;
      default:
        break;
    }
  deleteConfig(), writeOfflineStatus(), console.log(`Removed ${CONFIG_PATH_LABEL}.`), console.log(`Left in place: ${ATTESTED_PATH_LABEL} (written by the hook producer, not by this tracker),`), console.log("and the installed files themselves. To finish removing a terminal install:"), console.log("  rm -rf ~/.vibehub"), console.log("A Mac app install is removed by dragging VibeHub.app to the Trash.");
});
program2.command("run-loop", { hidden: !0 }).description("internal: runs the heartbeat loop in the foreground (spawned by `start`)").action(() => {
  let config = requireConfig();
  runForeground(config);
});
program2.command("serve", { hidden: !0 }).description("internal: foreground daemon for a supervisor (launchd) - owns tracker.pid; exits 0 if a healthy supervised tracker already runs").action(async () => {
  let config = requireConfig();
  await serveForeground(config, path5.resolve(__filename));
});
program2.command("hook <tool>", { hidden: !0 }).description("internal: record one Cursor/Windsurf hook event as AI-session metadata (payload on stdin)").action(async (tool) => {
  await runHookEvent(tool, process.stdin).catch(() => !1), process.exitCode = 0;
});
var hooks = program2.command("hooks").description("opt in to Cursor / Windsurf activity by installing VibeHub's hook in their own config");
hooks.command("install <tool>").description(`register the hook for ${HOOKABLE_TOOLS.join(" or ")} and consent to its records`).option("--dry-run", "print the exact file that would be written, and change nothing").action((tool, options) => {
  let config = requireConfig();
  isHookableTool(tool) || (console.error(`Unknown tool "${tool}". Supported: ${HOOKABLE_TOOLS.join(", ")}.`), process.exit(1));
  let plan = planHookInstall(tool, hookCommandFor(tool, process.execPath, path5.resolve(__filename)));
  if (options.dryRun) {
    console.log(`Would write ${plan.file}:`), console.log(plan.content ?? ""), console.log(`Would consent to "${tool}" records in ${CONFIG_PATH_LABEL}. Nothing was changed.`);
    return;
  }
  applyHookPlan(plan), setConsent(config, tool, !0), console.log(`${toolLabel(tool)} hook ${plan.changed ? "installed" : "already present"}: ${plan.file}`), console.log(`Events: ${plan.events.join(", ")}. Restart ${toolLabel(tool)} for it to pick the hook up.`), plan.existed && plan.changed && console.log(`Previous file kept as ${backupPathFor(tool)}.`), console.log(`Consented in ${CONFIG_PATH_LABEL}: the tracker now reads ${ATTESTED_PATH_LABEL} for ${toolLabel(tool)}.`), console.log("Each event records six fields: the tool, a random id, the time, the model when the id is one"), console.log("this tracker knows, and the project folder's name. No prompt, no path, no transcript, and no"), console.log("token count - neither tool reports one, so their usage stays unknown rather than zero."), path5.resolve(__filename).endsWith(".ts") && (console.log("Note: this is a source checkout, so the hook points at a TypeScript entry point that node"), console.log("cannot run on its own. Run `npm run build` and re-run this command for a hook that fires."));
});
hooks.command("uninstall <tool>").description("remove VibeHub's hook from that tool's config and withdraw consent").option("--dry-run", "print what would change, and change nothing").action((tool, options) => {
  let config = requireConfig();
  isHookableTool(tool) || (console.error(`Unknown tool "${tool}". Supported: ${HOOKABLE_TOOLS.join(", ")}.`), process.exit(1));
  let plan = planHookUninstall(tool, hookCommandFor(tool, process.execPath, path5.resolve(__filename)));
  if (options.dryRun) {
    console.log(plan.changed ? `Would rewrite ${plan.file}${plan.content === null ? " (removing it - nothing else is in it)" : ""}:` : `${plan.file} carries no VibeHub hook; nothing to remove.`), plan.changed && plan.content !== null && console.log(plan.content), console.log(`Would withdraw consent for "${tool}". Nothing was changed.`);
    return;
  }
  applyHookPlan(plan), setConsent(config, tool, !1), console.log(plan.changed ? `Removed the VibeHub hook from ${plan.file}.` : `No VibeHub hook was registered in ${plan.file}.`), console.log(`Withdrew consent for ${toolLabel(tool)}; its records are no longer read.`), console.log(`${ATTESTED_PATH_LABEL} is left alone - it belongs to the producer, not to this tracker.`);
});
hooks.command("status").description("show which hooks are installed and consented to").action(() => {
  let config = requireConfig();
  for (let state of hookStatus(config, process.execPath, path5.resolve(__filename)))
    console.log(`${toolLabel(state.tool)}:`), console.log(`  Consent: ${state.consented ? "yes" : "no"}`), console.log(`  Hook:    ${state.registered.length === 0 ? "not installed" : state.missing.length === 0 ? `installed (${state.registered.join(", ")})` : `partly installed (${state.registered.join(", ")}; missing ${state.missing.join(", ")})`}`), console.log(`  File:    ${state.file}${state.fileExists ? "" : " (absent)"}`), state.stale.length > 0 && (console.log(`  Stale:   ${state.stale.join(", ")} - registered by an older VibeHub and no longer used.`), console.log(`           Run \`vibehub-tracker hooks install ${state.tool}\` to clear them.`)), state.consented && state.registered.length === 0 && console.log(`  Note:    consented, but nothing writes records - run \`vibehub-tracker hooks install ${state.tool}\`.`), !state.consented && state.registered.length > 0 && console.log("  Note:    the hook is installed but its records are ignored until you consent again.");
  let inbox = inboxPresence();
  console.log(`Inbox:     ${inbox.path}${inbox.exists ? "" : " (not created yet)"}`), console.log("           Written only by the hook command; the tracker never writes it."), console.log("Tokens:    not reported by either tool, so usage stays unknown - never 0, never estimated.");
});
program2.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err), process.exit(1);
});
