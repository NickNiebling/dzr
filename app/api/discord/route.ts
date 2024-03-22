import axios from 'axios';

export async function POST(req: Request, res: Response) {
    const headers = req.headers;
    console.log(headers);
  const webhookUrl = process.env.DISCORD_WEB_HOOK_DZR_AFTER_PARTY
  if (!webhookUrl) {
    throw new Error('WEBHOOK_URL is not defined');
  }
  const message = 'Todays profile!'
  const imageUrl ='https://dzrracingseries.com/dzr-after-party/libby-hill-after-party+/Libby-Hill-After-Party+-profile.png'
  
  try {
      await axios.post(webhookUrl, {
          content: message,
          embeds: [
              {
                  image: {
                      url: imageUrl
                  }
              }
          ]
      });
      const responseMessage = `Discord message sent. Headers: ${JSON.stringify(headers)}`;
      return new Response(responseMessage);
      
  } catch (error) {

    return new Response('Error sending Discord message');      
  }
}