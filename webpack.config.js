const path = require('path')
require('dotenv').config()

const ASSET_PATH = process.env.ASSET_PATH || '/acc-module/'

module.exports = {
    mode: 'production',
    entry: {
        'acc-module': { import: path.join(__dirname, 'src', 'index.ts') },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        transpileOnly: true,
                    },
                },
                exclude: '/node_modules/',
            },
        ],
    },
    optimization: {
        minimize: true,
        splitChunks: false,
    },
    output: {
        path: path.resolve(__dirname, 'umd'),
        publicPath: ASSET_PATH,
        library: 'EpiCAccMod',
        libraryTarget: 'umd',
    },
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '#root': path.resolve(__dirname, './'),
            '#components': path.resolve(__dirname, 'src', 'components'),
            '#config': path.resolve(__dirname, 'src', 'config'),
            '#events': path.resolve(__dirname, 'src', 'events'),
            '#loader': path.resolve(__dirname, 'src', 'loader'),
            '#runtime': path.resolve(__dirname, 'src', 'runtime'),
            '#service': path.resolve(__dirname, 'src', 'service'),
            '#types': path.resolve(__dirname, 'src', 'types'),
        },
        symlinks: true
    },
}
