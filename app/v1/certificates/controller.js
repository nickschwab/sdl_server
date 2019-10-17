const async = require('async');
const pem = require('pem');
const fs = require('fs');
const logger = require('../../../custom/loggers/winston/index');
const settings = require('../../../settings.js');
const { spawnSync } = require('child_process');
const CA_DIR_PREFIX = __dirname + '/../../../customizable/ca/';

const authorityKey = (fs.existsSync(CA_DIR_PREFIX + settings.certificateAuthority.authorityKeyFileName)) ? 
    //file exists
    fs.readFileSync(CA_DIR_PREFIX + settings.certificateAuthority.authorityKeyFileName).toString() : 
    //file does not exist
    null;
const authorityCertificate = (fs.existsSync(CA_DIR_PREFIX + settings.certificateAuthority.authorityCertFileName)) ? 
    //file exists
    fs.readFileSync(CA_DIR_PREFIX + settings.certificateAuthority.authorityCertFileName).toString() : 
    //file does not exist
    null;

const openSSLEnabled = authorityKey && authorityCertificate 
    && settings.securityOptions.passphrase && settings.securityOptions.certificate.commonName;

function checkAuthorityValidity (cb){
    if (!openSSLEnabled) {
        return cb(false);
    }
    pem.createPkcs12(
        authorityKey, 
        authorityCertificate, 
        settings.securityOptions.passphrase, 
        {
            cipher: 'aes128',
            clientKeyPassword: settings.securityOptions.passphrase
        }, 
        function(err, pkcs12){
            cb((err) ? false : true);
        }
    ); 
}

function createPrivateKey(req, res, next){
    if (openSSLEnabled) {
        let options = getKeyOptions(req.body.options);
        pem.createPrivateKey(
            options.keyBitsize, 
            options, 
            function(err, privateKey){
                if(err){
                    return res.parcel.setStatus(400)
                        .setData(err)
                        .deliver();
                }
                return res.parcel.setStatus(200)
                    .setData(privateKey.key)
                    .deliver();
            }
        );
    } else {
        res.parcel.setStatus(400)
            .setMessage('Security options have not been properly configured')
            .deliver();
    }
}

function getKeyOptions(options = {}){
    return {
        keyBitsize: options.keyBitsize || settings.securityOptions.privateKey.keyBitsize,
        cipher: options.cipher || settings.securityOptions.privateKey.cipher,
    };
}

function getCertificateOptions(options = {}){
    return {
        serviceCertificate: authorityCertificate,
        serviceKey: authorityKey,
        serviceKeyPassword: settings.securityOptions.passphrase,
        clientKey: options.clientKey,
        keyBitsize: options.keyBitsize || settings.securityOptions.privateKey.keyBitsize,
        country: options.country || settings.securityOptions.certificate.country,
        state: options.state || settings.securityOptions.certificate.state,
        locality: options.locality || settings.securityOptions.certificate.locality,
        organization: options.organization || settings.securityOptions.certificate.organization,
        organizationUnit: options.organizationUnit || settings.securityOptions.certificate.organizationUnit,
        commonName: options.commonName || settings.securityOptions.certificate.commonName,
        emailAddress: options.emailAddress || settings.securityOptions.certificate.emailAddress,
        hash: settings.securityOptions.certificate.hash,
        days: options.days || settings.securityOptions.certificate.days,
        serialNumber: options.serialNumber,
    };
}

function createCertificate(req, res, next){
    if (openSSLEnabled) {
        let options = req.body.options || {};
        createCertificateFlow(options, function(err, results){
            if(err){
                logger.error(err);
                return res.parcel.setStatus(400)
                    .setData(err)
                    .deliver();
            }
            return res.parcel.setStatus(200)
                .setData(results)
                .deliver();
        });
    } else {
        res.parcel.setStatus(400)
            .setMessage('Security options have not been properly configured')
            .deliver();
    }
}

function createCertificateFlow(options, next){
    if (openSSLEnabled) {
        options.serviceKey = authorityKey;
        options.serviceCertificate = authorityCertificate;
        options.serviceKeyPassword = settings.securityOptions.passphrase;
        let tasks = [];

        let csrOptions = getCertificateOptions(options);

        //private key exists
        if(options.clientKey){
            tasks.push(function(cb){
                pem.createCSR(csrOptions, function(err, csr){
                    cb(err, csr);
                });
            });
        //private key does not exist
        } else {
            tasks.push(function(cb){
                options = getKeyOptions(options);
                pem.createPrivateKey(options.keyBitsize, options, function(err, key){
                    cb(err, key);
                });
            });
            tasks.push(function(privateKey, cb){
                csrOptions.clientKey = privateKey.key;
                pem.createCSR(csrOptions, function(err, csr){
                    cb(err, csr);
                });
            });
        }
        tasks.push(function(csr, cb){
            csrOptions.csr = csr.csr;
            pem.createCertificate(csrOptions, function(err, certificate){
                cb(err, certificate);
            });
        });
        async.waterfall(tasks, next);
    } else {
        next('Security options have not been properly configured');
    }
}

module.exports = {
    authorityKey: authorityKey,
    authorityCertificate: authorityCertificate,
    createPrivateKey: createPrivateKey,
    createCertificate: createCertificate,
    createCertificateFlow: createCertificateFlow,
    checkAuthorityValidity: checkAuthorityValidity,
    getKeyOptions: getKeyOptions,
    getCertificateOptions: getCertificateOptions,
    openSSLEnabled: openSSLEnabled,
}