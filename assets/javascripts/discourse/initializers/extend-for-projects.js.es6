import Composer from 'discourse/models/composer';

export default {
    name: 'extend-for-projects',
    initialize() {
        Composer.serializeOnCreate('parent_guids');
        //Composer.serializeToTopic('parent_guids', 'topic.parent_guids');
    }
}
