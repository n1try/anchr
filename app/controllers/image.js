var express = require('express'),
    router = express.Router(),
    fs = require('fs'),
    path = require('path'),
    config = require('../../config/config'),
    utils = require('../../utils'),
    log = require('./../../config/middlewares/log')(),
    logger = require('./../../config/log')(),
    _ = require('underscore'),
    auth = require('./../../config/middlewares/auth'),
    filetype = require('./../../config/middlewares/filetype'),
    multipart = require('connect-multiparty'),
    mongoose = require('mongoose'),
    Image = mongoose.model('Image');

module.exports = function (app, passport) {
    app.use('/api/image', router);
    app.use('/i', router);
    router.use(log);

    /**
     * @swagger
     * /image/{id}:
     *    get:
     *      summary: Get an image by ID
     *      tags:
     *        - image
     *      parameters:
     *        - $ref: '#/parameters/imageId'
     *      produces:
     *        - application/json
     *        - image/jpeg
     *        - image/png
     *        - image/gif
     *        - image/bmp
     *        - image/svg+xml
     *      responses:
     *          200:
     *            description: The image's meta data object
     *            schema:
     *              $ref: '#/definitions/Image'
     */
    router.get('/:id', function (req, res) {
        var asJson = req.get('accept') === 'application/json';

        Image.findOne({ _id: req.params.id }, { __v: false, ip: false, createdBy: false }, function (err, obj) {
            if (err) return res.makeError(500, err.message, err);
            if (!obj) return res.makeError(404, 'Image not found.');

            var image = _.omit(obj.toObject(), 'id')
            image.hrefProxied = config.imageProxyUrlTpl ? config.imageProxyUrlTpl.replace('{0}', image.href) : null

            var filePath = config.uploadDir + obj._id;
            fs.exists(filePath, function (exists) {
                if (!exists) return res.makeError(404, "File not found.");
                if (asJson) res.send(image);
                else res.sendFile(filePath);
            });
        });
    });

    /**
     * @swagger
     * /image:
     *    post:
     *      summary: Add a new image
     *      tags:
     *        - image
     *      security:
     *        - ApiKeyAuth: []
     *      parameters:
     *        - $ref: '#/parameters/imageFile'
     *        - $ref: '#/parameters/imageEncrypted'
     *      consumes:
     *        - multipart/form-data
     *      produces:
     *        - application/json
     *      responses:
     *          200:
     *            description: The image's meta data object
     *            schema:
     *              $ref: '#/definitions/Image'
     */
    router.post('/', auth(passport), multipart({ maxFilesSize: config.maxFilesSize }), filetype(config.allowedFileTypes), function (req, res) {
        var FILE_UPLOAD_FIELD = "uploadFile";

        var tmpPath = req.files[FILE_UPLOAD_FIELD].path;
        var newName = utils.generateUUID() + path.parse(tmpPath).ext.toLowerCase();
        var newPath = config.uploadDir + newName;

        function onSuccess() {
            var img = new Image({
                _id: newName,
                created: Date.now(),
                ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip,
                encrypted: req.body.encrypted || false,
                type: req.files[FILE_UPLOAD_FIELD].type,
                createdBy: req.user._id
            });

            img.save(function (err, obj) {
                if (err) return res.makeError(500, 'Unable to save file.', err);
                res.status(201).send(_.omit(img.toObject(), '__v', 'ip', 'id', 'createdBy', 'created'));
            });
        }

        fs.rename(tmpPath, newPath, function (err) {
            if (!err) return onSuccess();
            switch (err.code) {
                case 'EXDEV':
                    fs.copyFile(tmpPath, newPath, function (err) {
                        if (err) return res.makeError(500, 'Unable to save file.', err);

                        fs.unlink(tmpPath, function (err) {
                            if (err) logger.default('[WARN] Failed to unlink file ' + tmpPath);
                            onSuccess();
                        });
                    });
                    break;
                default:
                    return res.makeError(500, 'Unable to save file.', err);
            }
        })
    });
};