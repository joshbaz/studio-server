export const renderOTPTemplate = (otp) => {
   return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
            <html dir="ltr" lang="en">
            <head>
                <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
                <meta name="x-apple-disable-message-reformatting" />
            </head>
            <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">Your Nyati Motion Pictures OTP code </div>

            <body style="background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,Oxygen-Sans,Ubuntu,Cantarell,&quot;Helvetica Neue&quot;,sans-serif">
                <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:560px;margin:0 auto;padding:20px 0 48px">
                <tbody>
                    <tr style="width:100%">
                    <td><img alt="Nyati Motion Pictures" height="42" src="https://ik.imagekit.io/alero/Nyati_Films/website-metadata/Universal+Home/Logos/Logo1.svg?updatedAt=1722395100447" style="display:block;outline:none;border:none;text-decoration:none;border-radius:21px;width:42px;height:42px" width="42" />
                        <h1 style="font-size:24px;letter-spacing:-0.5px;line-height:1.3;font-weight:400;color:#484848;padding:17px 0 0">Your Nyati OTP Code</h1>
                        <p style="font-size:15px;line-height:1.4;margin:0 0 15px;color:#3c4149">This code will only be valid for the next 10 minutes:</p><code style="font-family:monospace;font-weight:700;padding:1px 4px;background-color:#dfe1e4;letter-spacing:-0.3px;font-size:21px;border-radius:4px;color:#3c4149">${otp}</code>
                        <hr style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#dfe1e4;margin:42px 0 26px" /><a href="https://staging.nyatimotionpictures.com/" style="color:#b4becc;text-decoration:none;font-size:14px" target="_blank">Nyati Motion Pictures</a>
                    </td>
                    </tr>
                </tbody>
                </table>
            </body>
            </html>
`;
};

export const renderVerificationTemplate = (code) => {
   return `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
  <html dir="ltr" lang="en">
    <head>
      <link rel="preload" as="image" href="https://ik.imagekit.io/alero/Nyati_Films/website-metadata/Universal+Home/Logos/Logo1.svg" />
      <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
      <meta name="x-apple-disable-message-reformatting" />
    </head>
    <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">Nyati Verification Code</div>

    <body style="background-color:#fff;color:#212121">
      <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="width:100%;height:100%;min-height:600px;padding:20px;margin:0 auto;background-color:#eee">
        <tbody>
          <tr style="width:100%">
            <td>
              <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="background-color:#fff;max-width:40em;margin:0 auto;">
                <tbody>
                  <tr>
                    <td>
                      <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="background-color:#141118;display:flex;padding:20px 0;align-items:center;justify-content:center">
                        <tbody>
                          <tr>
                            <td><img alt="Nyati Logo" height="45" src="https://ik.imagekit.io/alero/Nyati_Films/website-metadata/Universal+Home/Logos/Logo1.svg" style="display:block;outline:none;border:none;text-decoration:none" width="75" /></td>
                          </tr>
                        </tbody>
                      </table>
                      <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="padding:25px 35px">
                        <tbody>
                          <tr>
                            <td>
                              <h1 style="color:#333;font-family:-apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, &#x27;Roboto&#x27;, &#x27;Oxygen&#x27;, &#x27;Ubuntu&#x27;, &#x27;Cantarell&#x27;, &#x27;Fira Sans&#x27;, &#x27;Droid Sans&#x27;, &#x27;Helvetica Neue&#x27;, sans-serif;font-size:28px;font-weight:semibold;margin-bottom:10px;text-align:center">Verification Code</h1>
                              <p style="font-size:14px;line-height:24px;margin:0;color:#333;font-family:-apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, &#x27;Roboto&#x27;, &#x27;Oxygen&#x27;, &#x27;Ubuntu&#x27;, &#x27;Cantarell&#x27;, &#x27;Fira Sans&#x27;, &#x27;Droid Sans&#x27;, &#x27;Helvetica Neue&#x27;, sans-serif;margin-bottom:14px;text-align:center">Here is your code for verification:</p>
                              <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="display:flex;align-items:center;justify-content:center">
                                <tbody>
                                  <tr>
                                    <td>
                                      <p style="font-size:36px;line-height:24px;margin:10px 0;color:#333;font-family:-apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, &#x27;Roboto&#x27;, &#x27;Oxygen&#x27;, &#x27;Ubuntu&#x27;, &#x27;Cantarell&#x27;, &#x27;Fira Sans&#x27;, &#x27;Droid Sans&#x27;, &#x27;Helvetica Neue&#x27;, sans-serif;font-weight:normal;text-align:center">${code}</p>
                                      <p style="font-size:14px;line-height:24px;margin:0px;color:#333;font-family:-apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, &#x27;Roboto&#x27;, &#x27;Oxygen&#x27;, &#x27;Ubuntu&#x27;, &#x27;Cantarell&#x27;, &#x27;Fira Sans&#x27;, &#x27;Droid Sans&#x27;, &#x27;Helvetica Neue&#x27;, sans-serif;text-align:center">This code will only be valid for the next 10 minutes. If this request did not come from you, change your account password immediately to prevent further unauthorized access.</p>
                                      <p style="font-size:14px;line-height:24px;margin:10px 0px;color:#333;font-family:-apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, &#x27;Roboto&#x27;, &#x27;Oxygen&#x27;, &#x27;Ubuntu&#x27;, &#x27;Cantarell&#x27;, &#x27;Fira Sans&#x27;, &#x27;Droid Sans&#x27;, &#x27;Helvetica Neue&#x27;, sans-serif;text-align:center">This is an automated message, please do not reply.</p>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
                </table>
                <p style="width:100%;font-size:12px;line-height:24px;margin:24px 0;color:#333;font-family:-apple-system, BlinkMacSystemFont, &#x27;Segoe UI&#x27;, &#x27;Roboto&#x27;, &#x27;Oxygen&#x27;, &#x27;Ubuntu&#x27;, &#x27;Cantarell&#x27;, &#x27;Fira Sans&#x27;, &#x27;Droid Sans&#x27;, &#x27;Helvetica Neue&#x27;, sans-serif;padding:0;text-align:center;"> <a href="https://staging.nyatimotionpictures.com/" style="text-decoration:none;font-size:14px;color:#333;" target="_blank" rel="noopener noreferrer"> © 2024 by Nyati Motion Pictures</a></p>
            </td>
          </tr>
        </tbody>
      </table>
    </body>
  </html>
`;
};

export const renderSubscriptionTemplate = (subType, user) => {
   return `
   <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">

  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
  </head>
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">Your Nyati Motion Pictures subscription plan is ready.</div>

  <body style="background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,Oxygen-Sans,Ubuntu,Cantarell,&quot;Helvetica Neue&quot;,sans-serif">
    <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:37.5em;margin:0 auto;padding:20px 0 48px">
      <tbody>
        <tr style="width:100%">
          <td><img alt="Nyati Motion Pictures" height="50" src="https://ik.imagekit.io/alero/Nyati_Films/website-metadata/Universal+Home/Logos/Logo1.svg?updatedAt=1722395100447" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto" width="170" />
            <p style="font-size:16px;line-height:26px;margin:16px 0">Hi <!-- -->${user?.firstName}<!-- -->,</p>
            <p style="font-size:16px;line-height:26px;margin:16px 0"></p>
            <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="text-align:center">
              <tbody>
                <tr>
                  <td><a href="https://getkoala.com" style="line-height:100%;text-decoration:none;display:block;max-width:100%;background-color:#5F51E8;border-radius:3px;color:#fff;font-size:16px;text-align:center;padding:12px 12px 12px 12px" target="_blank"><span><!--[if mso]><i style="mso-font-width:300%;mso-text-raise:18" hidden>&#8202;&#8202;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:9px">Get started</span><span><!--[if mso]><i style="mso-font-width:300%" hidden>&#8202;&#8202;&#8203;</i><![endif]--></span></a></td>
                </tr>
              </tbody>
            </table>
            <p style="font-size:16px;line-height:26px;margin:16px 0">Best,<br />The Koala team</p>
            <hr style="width:100%;border:none;border-top:1px solid #eaeaea;border-color:#cccccc;margin:20px 0" />
            <p style="font-size:12px;line-height:24px;margin:16px 0;color:#8898aa">470 Noor Ave STE B #1148, South San Francisco, CA 94080</p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
    `;
};
