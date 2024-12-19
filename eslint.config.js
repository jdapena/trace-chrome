const globals = require('globals');
const googleConfig = require('eslint-config-google');
const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    googleConfig,
    {
        ignores: ["node_modules/"],
        files: ["src/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.mocha,
            },
            ecmaVersion: 9,
            sourceType: "commonjs",
        },
        rules: {
            "require-jsdoc": "off"
        }
    }
];