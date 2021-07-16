import * as AdmZip from 'adm-zip';
import { request } from 'http';
import { createMultipart /*, createResponseMessage */} from './mime';
import { parseString } from 'xml2js';
import { ServerResult } from '../client/server_result';

/*
1. Gather all the information for the message from the text (start with hardcoded)
3. Create the message
4. Figure out address, port etc and send message
5. Parse response to get ID
6. Poll server (GET at /p/<responseID>) until done
7. Send "response" message to server
8. Unpack response to get validation results
*/

const oracc_log = `00atf/error_belsunu.atf:6:X001001: unknown block token: tableta
00atf/error_belsunu.atf:44:X001001: o 4: translation uses undefined label
ATF processor ox issued 2 warnings and 0 notices`;

export function validate(filename: string, project: string, text: string): ServerResult {
    let responseID:string;
    // First create the body of the message, since we'll need some information
    // from it to create the headers
    const zip = new AdmZip();
    // text.length does not account for the encoding, so using that will allocate
    // less memory that required and truncate the text in the zip!
    zip.addFile(`00atf/${filename}`, Buffer.alloc(Buffer.byteLength(text), text));
    const encodedText = zip.toBuffer().toString();
    // TODO replace this with appropriate commands and reponse ID params
    const fullMessage = createMultipart("atf", filename, project, encodedText,
                                        null);
    let body = fullMessage.toString({noHeaders: true});
    const boundary = fullMessage.contentType().params.boundary;

    const headers = {
        'Connection': 'close',
        'MIME-Version': '1.0',
        // TODO: What if boundary contains a "? Do we need to escape it?
        'Content-Type': `multipart/related; charset="utf-8"; type="application/xop+xml"; start="<SOAP-ENV:Envelope>"; start-info="application/soap+xml"; boundary="${boundary}"`,
        // TODO: Also add Content-Length here
    }
    const options = {
        host: "build-oracc.museum.upenn.edu",
        port: 8085,
        method: 'POST',
        headers: headers,
    }
    const req = request(options);
    req.on('response', (res) => {
        console.log("DONE");

        // DEBUG
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
        res.setEncoding('utf8');
        if (res.statusCode !== 200) {
            console.error(`Request failed! Status: ${res.statusCode}`);
            res.resume(); // Apparently needed to free up memory if we don't read the data?
        }
        // Parse the response to get the response ID
        res.on('data', (chunk) => {
            responseID = getResponseCode(chunk);
            console.log(responseID);
            // Wait until the server has prepared the response
            if (commandSuccessful(responseID, options.host)) {
                console.log(`Request ${responseID} is done.`);
                // Send Response message
                // let ourResponse = createResponseMessage(responseID);
                // TODO continue...
            } else {
                console.log('Unsuccessful getting response.')
            }
            }
        );
    });
    // Time out after 5 seconds
    req.setTimeout(5000, () => {
        console.log("No response from server within limit, giving up.");
        req.destroy();
    });
    // DEBUG
    req.on('error', (err) => {
        console.log(`ERROR! ${err.message}`);
    })

    // We probably don't need this? It's to convert all line endings to \r\n because reasons (see Nammu)
    body = body.replace("\r\n", "\n").replace("\n", "\r\n");
    //console.log(body);
    // This is what it should be? Or perhaps only part of the body
    req.setHeader('Content-Length', Buffer.byteLength(body));
    // This is what Nammu sends
    // req.setHeader('Content-Length', 2779);
    console.log(`byte length: ${Buffer.byteLength(body)}`);
    console.log(`length: ${body.length}`);
    req.write(body);
    console.log(JSON.stringify(req.getHeaders()));
    req.end();
    console.log('Sent message');

    console.log(fullMessage.toString());

    //TODO this is just a placeholder
    return new ServerResult(oracc_log);
}


function getResponseCode(xmlResponse: string): string {
    let code: string;
    parseString(xmlResponse, (err, res) => {
        const response = res['SOAP-ENV:Envelope']['SOAP-ENV:Body'][0]['osc-meth:RequestResponse'][0];
        code = response['osc-data:keys'][0]['osc-data:key'][0];
    })
    return code;
}


function commandSuccessful(responseID: string, url: string): boolean {
    let done = false;
    let attempts = 0;
    // This is wrong! The requests are sent asynchronously, so the function
    // will return (false) even if the message returned is "done".
    while (!done && attempts < 10) {
        attempts += 1;
        request({host: url, path: `/p/${responseID}`, timeout: 5000}, (res) => {
            res.on('data', (chunk: Buffer) => {
                // Message includes a trailing new line character
                switch (chunk.toString('utf-8').trim()) {
                    case 'done': // done processing
                        done = true;
                        break;
                    case 'err_stat':
                        // TODO: Raise this properly
                        console.error('Error getting response from server.');
                        break;
                    case 'run':
                        console.error('Server working on request.');
                        break;
                    default:
                        // TODO: Raise this properly
                        console.error('Unexpected message from server.');
                }
            });
        }).end();
    }
    return done;
}
