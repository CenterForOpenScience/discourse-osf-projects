/*jshint esversion: 6*/
import Composer from 'discourse/models/composer';
import showModal from 'discourse/lib/show-modal';
import { filterQueryParams, findTopicList } from 'discourse/routes/build-topic-route';
import { queryParams } from 'discourse/controllers/discovery-sortable';

const ProjectsShowRoute = Discourse.Route.extend({
    queryParams,
    controllerName: 'projects.show',
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
            f += params.category + '/l/';
        }
        f += this.get('navMode');
        if (this.get('period')) {
            f += '/' + this.get('period');
        }
        this.set('filterMode', f);

        if (params.category) {
            this.set('categorySlug', params.category);
            this.set('category', params.category ? Discourse.Category.findBySlug(params.category, params.parent_category) : null);
        }
        if (params.parent_category) {
            this.set('parentCategorySlug', params.parent_category);
        }

        var model = {
            guid: project_guid,
            navMode: this.get('navMode'),
            filter: this.get('filterMode'),
            category: this.get('category'),
            queryParams: filterQueryParams(params),
        };

        return model;
    },

    afterModel(model) {
        const controller = this.controllerFor('projects.show');
        const topicController = this.controllerFor('discovery.topics');
        topicController.set('category', this.get('category'));
        topicController.setProperties(model.queryParams);

        // Track only this project_guid
        this.topicTrackingState.set('project_guid', model.guid);

        var self = this;
        // by returning the promise, Ember pauses until it completes. (Ember does not use the value)
        return findTopicList(this.store, this.topicTrackingState, this.get('filterMode'), model.queryParams, {}).then(function(list) {
            list.set('navMode', self.get('navMode'));
            controller.set('list', list);
            controller.set('period', list.get('for_period'));
            controller.set('canCreateTopic', list.get('can_create_topic'));
            topicController.set('model', list);
            topicController.set('period', list.get('for_period'));
        });
    },

    // Title of the page for the browser window/tab
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
        // are many different routes all with slightly different names. (showUnread, showNew, etc...)
        this.controllerFor('projects.show').setProperties({
            model,
        });
    },

    resetController(controller, isExiting) {
      if (isExiting) {
        this.controllerFor('discovery.topics').setProperties({ order: "default", ascending: false });
      }
    },

    // No need to do anything. We just need to handle this action/message the discovery.topics.
    loadingComplete(){
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
    }
});

export default ProjectsShowRoute;
