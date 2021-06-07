const AdmZip = require('adm-zip'); // It seems this has to be imported old-style
import { request } from 'http';
import { createMultipart /*, createResponseMessage */} from './mime';
import { parseString } from 'xml2js';

/*
1. Gather all the information for the message from the text (start with hardcoded)
3. Create the message
4. Figure out address, port etc and send message
5. Parse response to get ID
6. Poll server (GET at /p/<responseID>) until done
7. Send "response" message to server
8. Unpack response to get validation results
*/

const sampleText = `
&X001001 = JCS 48, 089
#project: cams/gkab
#atf: lang akk-x-stdbab
#atf: use unicode
#atf: use math
@tablet
@obverse

1.	[MU] 1.03-KAM {iti}AB GE₆ U₄ 2-KAM
#lem: šatti[year]N; n; Ṭebetu[1]MN; mūša[at night]AV; ūm[day]N; n

2.	[{m}]{d}60--EN-šu₂-nu a-lid
#lem: Anu-belšunu[1]PN; alid[born]AJ +.

$ single ruling
# I've added various things for test purposes

3.	U₄!-BI? 20* [(ina)] 9.30 ina(DIŠ) MAŠ₂!(BAR)
#lem: ūmišu[day]N; Šamaš[1]DN; ina[in]PRP; n; +ina[in]PRP$; Suhurmašu[Goatfish]CN
#note: Note to line.

4.	<30> <(ina)> 12 GU U₄-ME-šu₂ GID₂-MEŠ{{ir-ri-ku}}
#lem: Sin[1]DN; ina[at]PRP; n; Gula[1]'CN; ūmūšu[day]N; +arāku[be(come) long]V$irrikū +.; irrikū[be(come) long]V

5.	[GU₄].U₄ ina MAŠ₂ GENNA ina MIN<(MAŠ₂)>
#lem: Šihṭu[Mercury]CN; ina[in]PRP; Suhurmašu[Goatfish]CN +.; Kayyamanu[Saturn]CN; ina[in]PRP; Suhurmašu[Goatfish]CN

6.	[AN] ina ALLA <<ALLA>>
#lem: Ṣalbatanu[Mars]CN; ina[in]PRP; Alluttu[Crab]CN +.

7.    $BI x X |DU.DU| |GA₂×AN| |DU&DU| |LAGAB&LAGAB| DU@g GAN₂@t 4(BAN₂)@v
#lem: u; u; X; X; X; X; X; X; X; n

$ (a loose dollar line)

@reverse
$ reverse blank

@translation parallel en project
@obverse
1.	Year 63, Ṭebetu (Month X), night of day 2:^1^

@note ^1^ A note to the translation.

2.	Anu-belšunu was born.
3.	That day, the Sun was 9;30˚ in the Goat.
4.	The Moon was 12˚ in the Bucket: his days will be long.
5.	Jupiter was at the head of the Scorpion: someone will take the prince's hand.
6.	[The child] was born in the Bucket in the region of Venus: he will have sons.
7.	Mercury was in the Goat; Saturn was in the Goat;
8.	Mars was in the Crab.
`;

export function validate(filename: string, project: string, text: string): boolean {
    let responseID:string;
    // First create the body of the message, since we'll need some information
    // from it to create the headers
    const zip = new AdmZip();
    // text.length does not account for the encoding, so using that will allocate
    // less memory that required and truncate the text in the zip!
    zip.addFile(`00atf/${filename}`, Buffer.alloc(Buffer.byteLength(text), text));
    const encodedText = zip.toBuffer();
    const fullMessage = createMultipart(filename, project, encodedText);
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

    //TODO implement this!
    return true;
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
validate('belsunu.atf', 'cams/gkab', sampleText);