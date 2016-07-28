/*jshint esversion: 6*/
import Composer from 'discourse/models/composer';
import showModal from 'discourse/lib/show-modal';
import { findTopicList } from 'discourse/routes/build-topic-route';

const ProjectsShowRoute = Discourse.Route.extend({
    navMode: 'latest',
    filterMode: 'latest',
    period: null,

    renderTemplate() {
        const controller = this.controllerFor('projects.show');
        this.render('projects.show', {
            controller: controller
        });
        this.render('discovery.topics', {
            outlet: 'list-container',
            into: 'projects.show'
        });
    },

    model(params) {
        var project_guid = Handlebars.Utils.escapeExpression(params.project_guid);

        var f = 'forum/' + project_guid + '/';
        if (params.category) {
            f += 'c/';
            if (params.parent_category) {
                f += params.parent_category + '/';
            }
            f += params.category + '/';
        }
        f += 'l/' + this.get('navMode');
        if (params.period) {
            f += '/' + params.period;
        }
        this.set('filterMode', f);

        if (params.category) {
            this.set('categorySlug', params.category);
            this.set('category', params.category ? Discourse.Category.findBySlug(params.category, params.parent_category) : null);
        }
        if (params.parent_category) {
            this.set('parentCategorySlug', params.parent_category);
        }

        var project = {
            guid: project_guid,
            navMode: this.get('navMode'),
            filter: this.get('filterMode'),
            category: this.get('category'),
        };

        return project;
    },

    afterModel(project) {
        const controller = this.controllerFor('projects.show');
        const topicController = this.controllerFor('discovery.topics');
        controller.set('loading', true);
        topicController.set('period', this.get('period'));
        topicController.set('category', this.get('category'));

        const params = controller.getProperties('order', 'ascending');
        var self = this;
        return findTopicList(this.store, this.topicTrackingState, this.get('filterMode'), params, {}).then(function(list) {
            list.set('navMode', self.get('navMode'));
            controller.set('list', list);
            controller.set('loading', false);
            controller.set('canCreateTopic', list.get('can_create_topic'));
            topicController.set('model', list);
        });
    },

    titleToken() {
        const filterText = I18n.t('filters.' + this.get('navMode').replace('/', '.') + '.title');
        var controller = this.controllerFor('projects.show');
        var category = controller.get('model.category');
        if (category) {
            return I18n.t('filters.with_category', { filter: filterText, category: category.get('name') });
        } else {
            return I18n.t('filters.with_topics', {filter: filterText});
        }
    },

    setupController(controller, model) {
        // Make sure it uses the projects.show controller, even though there
        // are many differently routes all with slightly different names.
        this.controllerFor('projects.show').setProperties({
            model,
        });
    },

    actions: {
        invalidateModel() {
            this.refresh();
        },

        createTopic() {
            var controller = this.controllerFor('projects.show');
            var self = this;

            this.controllerFor('composer').open({
                categoryId: controller.get('model.category.id'),
                action: Composer.CREATE_TOPIC,
                draftKey: controller.get('list.draft_key'),
                draftSequence: controller.get('list.draft_sequence')
            }).then(function() {
                // Pre-fill the project specific attributes
                if (controller.get('model.guid')) {
                    var c = self.controllerFor('composer').get('model');
                    c.set('parent_guids', controller.get('list.topic_list.parent_guids'));
                    c.set('parent_names', controller.get('list.topic_list.parent_names'));
                }
            });
        },

        didTransition() {
            this.controllerFor('projects.show')._showFooter();
            return true;
        },

        willTransition(transition) {
            //if (!Discourse.SiteSettings.show_filter_by_tag) { return true; }

            //if ((transition.targetName.indexOf('discovery.parentCategory') !== -1 ||
            //    transition.targetName.indexOf('discovery.category') !== -1) && !transition.queryParams.allTags ) {
            //this.transitionTo('/projects' + transition.intent.url + '/' + this.currentModel.get('id'));
            //}
            return true;
        }
    }
});

export default ProjectsShowRoute;
